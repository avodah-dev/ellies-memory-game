import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppUpdateStore } from "../../stores/appUpdateStore";
import { createBuildUpdateDetector, UPDATE_RECEIPT_KEY } from "./buildUpdate";
const current = "a".repeat(40),
	next = "b".repeat(40),
	newer = "c".repeat(40);
const health = (commit = current, environment = "preview") =>
	Response.json({ status: "ok", commit, environment });
let disposers: (() => void)[] = [];
function fixture(response: () => Promise<Response> = async () => health()) {
	const request = vi.fn<typeof fetch>(response);
	const store = createAppUpdateStore();
	const record = vi.fn();
	const detector = createBuildUpdateDetector({
		running: current,
		environment: () => "preview",
		store,
		request,
		record,
	});
	disposers.push(() => detector.stop());
	return { detector, request, store, record };
}
beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(document, "visibilityState", {
		value: "visible",
		configurable: true,
	});
	sessionStorage.clear();
});
afterEach(async () => {
	disposers.forEach((stop) => stop());
	disposers = [];
	await Promise.resolve();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("checks the same-origin served hash with no-store, including preview configuration", async () => {
	const { detector, request, store } = fixture();
	detector.start();
	await detector.check("test");
	expect(request).toHaveBeenCalledTimes(1);
	expect(request).toHaveBeenCalledWith(
		"/healthz",
		expect.objectContaining({
			cache: "no-store",
			signal: expect.any(AbortSignal),
		}),
	);
	expect(store.getState()).toEqual({
		offered: null,
		minimized: false,
		error: null,
	});
});

it("offers any different hash including rollback, deduplicates rolling-server observations", async () => {
	const { detector, request, store, record } = fixture(async () =>
		health(next),
	);
	detector.start();
	await detector.check("test");
	expect(store.getState().offered).toBe(next);
	await detector.check("poll");
	expect(record.mock.calls.map(([e]) => e.phase)).toEqual([
		"mismatch-seen",
		"prompt-shown",
	]);
	detector.defer();
	request.mockResolvedValueOnce(health(current));
	await detector.check("poll");
	expect(store.getState().offered).toBeNull();
	await detector.check("poll");
	expect(store.getState()).toMatchObject({ offered: next, minimized: true });
	expect(
		record.mock.calls.filter(([e]) => e.phase === "mismatch-seen"),
	).toHaveLength(1);
	request.mockResolvedValueOnce(health(newer));
	await detector.check("poll");
	expect(store.getState()).toMatchObject({ offered: newer, minimized: false });
});

it.each([
	() => Promise.reject(Error("offline")),
	async () => new Response("bad", { status: 503 }),
	async () => new Response("not json"),
	async () => Response.json(null),
	async () => health("short"),
	async () => health(next, "production"),
	async () =>
		Response.json({ status: "broken", commit: next, environment: "preview" }),
])(
	"preserves a known offer on failed or invalid background health checks",
	async (failure) => {
		const { detector, request, store } = fixture(async () => health(next));
		detector.start();
		await detector.check("test");
		request.mockImplementationOnce(failure);
		expect(await detector.check("poll")).toBeNull();
		expect(store.getState()).toMatchObject({ offered: next, error: null });
	},
);

it("coalesces lifecycle bursts and times out even if the transport ignores abort", async () => {
	const { detector, request, store } = fixture(() => new Promise(() => {}));
	detector.start();
	window.dispatchEvent(new Event("online"));
	window.dispatchEvent(new Event("pageshow"));
	document.dispatchEvent(new Event("visibilitychange"));
	const pending = detector.check("test");
	expect(request).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(5000);
	expect(await pending).toBeNull();
	expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
	expect(store.getState().offered).toBeNull();
	request.mockResolvedValueOnce(health(next));
	await detector.check("resume");
	expect(store.getState().offered).toBe(next);
});

it("polls only while visible and checks actual visibility/pageshow/online events", async () => {
	const { detector, request } = fixture();
	detector.start();
	await detector.check("test");
	await vi.advanceTimersByTimeAsync(60000);
	expect(request).toHaveBeenCalledTimes(2);
	Object.defineProperty(document, "visibilityState", {
		value: "hidden",
		configurable: true,
	});
	document.dispatchEvent(new Event("visibilitychange"));
	await vi.advanceTimersByTimeAsync(120000);
	window.dispatchEvent(new Event("online"));
	expect(request).toHaveBeenCalledTimes(2);
	Object.defineProperty(document, "visibilityState", {
		value: "visible",
		configurable: true,
	});
	document.dispatchEvent(new Event("visibilitychange"));
	await detector.check("test");
	window.dispatchEvent(new Event("pageshow"));
	await detector.check("test");
	window.dispatchEvent(new Event("online"));
	await detector.check("test");
	expect(request).toHaveBeenCalledTimes(5);
});

it("defers until a game boundary, ignores repeated renders, and records mode/round", async () => {
	const { detector, request, store, record } = fixture(async () =>
		health(next),
	);
	detector.boundary("local|playing|1", { mode: "local", game_round: 1 });
	detector.start();
	await detector.check("test");
	detector.defer();
	detector.defer();
	detector.boundary("local|playing|1", { mode: "local", game_round: 1 });
	expect(store.getState().minimized).toBe(true);
	expect(request).toHaveBeenCalledTimes(1);
	detector.boundary("local|finished|1", { mode: "local", game_round: 1 });
	await detector.check("test");
	expect(store.getState().minimized).toBe(false);
	expect(request).toHaveBeenCalledTimes(2);
	expect(record).toHaveBeenCalledWith(
		expect.objectContaining({
			phase: "prompt-shown",
			trigger: "boundary",
			mode: "local",
			game_round: 1,
		}),
	);
});

it("rechecks on explicit reload and records the actual post-navigation build", async () => {
	const { detector, request } = fixture(async () => health(next));
	detector.start();
	await detector.check("test");
	request.mockResolvedValueOnce(health(newer));
	expect(await detector.prepareReload()).toBe(true);
	expect(JSON.parse(sessionStorage.getItem(UPDATE_RECEIPT_KEY)!)).toMatchObject(
		{ target: newer, from: current },
	);
	detector.stop();
	const record = vi.fn();
	const boot = createBuildUpdateDetector({
		running: newer,
		environment: () => "preview",
		request: async () => health(newer),
		store: createAppUpdateStore(),
		record,
	});
	disposers.push(() => boot.stop());
	boot.start();
	await boot.check("test");
	expect(record).toHaveBeenCalledWith(
		expect.objectContaining({
			phase: "reload-outcome",
			outcome: "target-loaded",
			previous_commit: current,
			offered_commit: newer,
		}),
	);
	expect(sessionStorage.getItem(UPDATE_RECEIPT_KEY)).toBeNull();
});

it.each([current, newer])(
	"reports an unexpected post-reload build %s without retrying",
	async (running) => {
		sessionStorage.setItem(
			UPDATE_RECEIPT_KEY,
			JSON.stringify({ from: current, target: next, at: Date.now() }),
		);
		const record = vi.fn();
		const detector = createBuildUpdateDetector({
			running,
			environment: () => "preview",
			request: async () => health(running),
			store: createAppUpdateStore(),
			record,
		});
		disposers.push(() => detector.stop());
		detector.start();
		await detector.check("test");
		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "reload-outcome",
				outcome:
					running === current
						? "previous-build-loaded"
						: "different-build-loaded",
			}),
		);
	},
);

it.each(["offline", "current"])(
	"does not proceed with update reload when health is %s",
	async (kind) => {
		const { detector, request, store } = fixture(async () => health(next));
		detector.start();
		await detector.check("test");
		if (kind === "offline") request.mockRejectedValueOnce(Error("offline"));
		else request.mockResolvedValueOnce(health(current));
		expect(await detector.prepareReload()).toBe(false);
		expect(store.getState().error).toBeTruthy();
		expect(sessionStorage.getItem(UPDATE_RECEIPT_KEY)).toBeNull();
	},
);

it("ignores malformed and expired receipts and tolerates unavailable receipt storage", async () => {
	for (const receipt of [
		"bad-json",
		"null",
		JSON.stringify({ from: current, target: next, at: Date.now() - 3600001 }),
	]) {
		sessionStorage.setItem(UPDATE_RECEIPT_KEY, receipt);
		const { detector, record } = fixture();
		detector.start();
		await detector.check("test");
		detector.stop();
		expect(record).not.toHaveBeenCalled();
	}
	const { detector, record } = fixture(async () => health(next));
	detector.start();
	await detector.check("test");
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw Error("storage blocked");
	});
	expect(await detector.prepareReload()).toBe(true);
	expect(record).toHaveBeenCalledWith(
		expect.objectContaining({ phase: "receipt-unavailable" }),
	);
});

it("disposes listeners/timers and ignores a late health response", async () => {
	let resolve!: (value: Response) => void;
	const { detector, request, store } = fixture(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	detector.start();
	const pending = detector.check("test");
	detector.stop();
	resolve(health(next));
	await pending;
	expect(store.getState().offered).toBeNull();
	window.dispatchEvent(new Event("online"));
	window.dispatchEvent(new Event("pageshow"));
	document.dispatchEvent(new Event("visibilitychange"));
	await vi.advanceTimersByTimeAsync(120000);
	expect(request).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});

it("restarts cleanly before the cancelled request settles", async () => {
	let resolve!: (value: Response) => void;
	const { detector, request, store } = fixture(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	detector.start();
	const old = detector.check("test");
	detector.stop();
	request.mockResolvedValueOnce(health(newer));
	detector.start();
	await detector.check("test");
	resolve(health(next));
	await old;
	expect(store.getState().offered).toBe(newer);
	expect(request).toHaveBeenCalledTimes(2);
	detector.stop();
	await Promise.resolve();
	expect(vi.getTimerCount()).toBe(0);
});
