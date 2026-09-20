import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReloadMarker, reloadApp } from "./reloadApp";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function browser() {
	const replace = vi.fn();
	const unregister = vi.fn().mockResolvedValue(true);
	const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
	const deleteCache = vi.fn().mockResolvedValue(true);
	const keys = vi.fn().mockResolvedValue(["old-app", "old-images"]);
	vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } });
	vi.stubGlobal("window", {
		location: { origin: "https://play.matchimus.app", replace },
		caches: { keys, delete: deleteCache },
	});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	return { replace, unregister, getRegistrations, keys, deleteCache };
}

describe("explicit app reload", () => {
	it("removes workers before caches, then navigates to a unique same-origin home URL", async () => {
		const b = browser();
		let finishUnregister!: (value: boolean) => void;
		b.unregister.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishUnregister = resolve;
				}),
		);
		const pending = reloadApp();
		await vi.waitFor(() => expect(b.unregister).toHaveBeenCalled());
		expect(b.keys).not.toHaveBeenCalled();
		expect(b.replace).not.toHaveBeenCalled();
		finishUnregister(true);
		await pending;
		expect(b.deleteCache.mock.calls).toEqual([["old-app"], ["old-images"]]);
		const first = new URL(b.replace.mock.calls[0][0]);
		expect(first.origin).toBe("https://play.matchimus.app");
		expect(first.pathname).toBe("/");
		expect(first.searchParams.get("_matchimus_reload")).toBeTruthy();
		b.unregister.mockResolvedValue(true);
		await reloadApp();
		expect(b.replace.mock.calls[1][0]).not.toBe(first.href);
	});

	it("continues clearing other caches when individual cleanup operations fail", async () => {
		const b = browser();
		b.unregister.mockRejectedValue(new Error("denied"));
		b.deleteCache.mockRejectedValueOnce(new Error("blocked"));
		await reloadApp();
		expect(b.deleteCache).toHaveBeenCalledTimes(2);
		expect(console.warn).toHaveBeenCalledTimes(2);
		expect(b.replace).toHaveBeenCalledOnce();
	});

	it("still navigates when browser storage access is denied", async () => {
		const b = browser();
		b.getRegistrations.mockRejectedValue(
			new DOMException("denied", "SecurityError"),
		);
		b.keys.mockRejectedValue(new DOMException("denied", "SecurityError"));
		await reloadApp();
		expect(b.replace).toHaveBeenCalledOnce();
	});

	it("does not hang indefinitely on browser cleanup", async () => {
		vi.useFakeTimers();
		const b = browser();
		b.getRegistrations.mockImplementation(() => new Promise(() => {}));
		b.keys.mockImplementation(() => new Promise(() => {}));
		const pending = reloadApp();
		await vi.advanceTimersByTimeAsync(6000);
		await pending;
		expect(b.replace).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("works when the browser does not expose worker or cache APIs", async () => {
		const b = browser();
		vi.stubGlobal("navigator", {});
		delete (window as unknown as { caches?: unknown }).caches;
		await reloadApp();
		expect(b.replace).toHaveBeenCalledOnce();
	});

	it("consumes the reload marker without losing other URL or history state", () => {
		const replaceState = vi.fn();
		vi.stubGlobal("window", {
			location: {
				href: "https://play.matchimus.app/?_matchimus_reload=nonce&other=kept#hash",
			},
			history: { state: { saved: true }, replaceState },
		});
		consumeReloadMarker();
		expect(replaceState).toHaveBeenCalledWith(
			{ saved: true },
			"",
			"https://play.matchimus.app/?other=kept#hash",
		);
	});
});
