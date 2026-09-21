import { getRuntimeConfig } from "../../lib/runtimeConfig";
import {
	appUpdateStore,
	type createAppUpdateStore,
} from "../../stores/appUpdateStore";
import { track } from "../telemetry/core";
import type { RuntimeConfig } from "../../../shared/runtimeConfig";

const HASH = /^[a-f0-9]{40}$/;
export const UPDATE_RECEIPT_KEY = "matchimus-update-receipt";
const RECEIPT_LIFETIME = 60 * 60 * 1000;
type Fields = Record<string, string | number | boolean | null>;
interface Options {
	running: string;
	environment: () => RuntimeConfig["environment"];
	store?: ReturnType<typeof createAppUpdateStore>;
	request?: typeof fetch;
	record?: (fields: Fields) => void;
}

export function createBuildUpdateDetector({
	running,
	environment,
	store = appUpdateStore,
	request = (...args) => fetch(...args),
	record = (fields) => track("mm.app.update", fields),
}: Options) {
	let active = false;
	let lifecycle = 0;
	let pending: Promise<string | null> | null = null;
	let controller: AbortController | null = null;
	let poll: ReturnType<typeof setTimeout> | undefined;
	let boundary: string | null = null;
	let details: Fields = {};
	const seen = new Set<string>();
	const deferred = new Set<string>();
	const emit = (
		phase: string,
		offered: string | null,
		trigger: string,
		extra: Fields = {},
	) =>
		record({
			...details,
			phase,
			running_commit: running,
			offered_commit: offered,
			trigger,
			...extra,
		});
	const remember = (set: Set<string>, value: string) => {
		if (set.size === 32) set.delete(set.values().next().value!);
		set.add(value);
	};
	const visible = () => document.visibilityState === "visible";
	const check = (trigger: string): Promise<string | null> => {
		if (!active) return Promise.resolve(null);
		if (pending && controller && !controller.signal.aborted) return pending;
		const epoch = lifecycle;
		const owner = new AbortController();
		controller = owner;
		const signal = owner.signal;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const work = async () => {
			try {
				const commit = await Promise.race([
					(async () => {
						const response = await request("/healthz", {
							cache: "no-store",
							signal,
						});
						if (!response.ok) throw Error("Health request failed");
						const data: unknown = await response.json();
						if (
							!data ||
							typeof data !== "object" ||
							!("status" in data) ||
							data.status !== "ok" ||
							!("environment" in data) ||
							data.environment !== environment() ||
							!("commit" in data) ||
							typeof data.commit !== "string" ||
							!HASH.test(data.commit)
						)
							throw Error("Invalid health response");
						return data.commit;
					})(),
					new Promise<never>((_, reject) => {
						signal.addEventListener(
							"abort",
							() => reject(Error("Health request cancelled")),
							{ once: true },
						);
						deadline = setTimeout(() => owner.abort(), 5000);
					}),
				]);
				if (!active || epoch !== lifecycle || signal.aborted) return null;
				if (commit === running) {
					store.setState({ offered: null, minimized: false, error: null });
				} else if (store.getState().offered !== commit) {
					store.setState({
						offered: commit,
						minimized: deferred.has(commit),
						error: null,
					});
					if (!seen.has(commit)) {
						remember(seen, commit);
						emit("mismatch-seen", commit, trigger);
						emit("prompt-shown", commit, trigger);
					}
				}
				return commit;
			} catch {
				if (active && epoch === lifecycle && trigger === "reload") {
					store.setState({
						error:
							"Could not check the update. Check your connection and try again.",
					});
					emit("check-failed", store.getState().offered, trigger);
				}
				return null;
			} finally {
				clearTimeout(deadline);
				owner.abort();
				if (controller === owner) controller = null;
			}
		};
		const result = work().finally(() => {
			if (pending === result) pending = null;
		});
		pending = result;
		return result;
	};
	const schedule = () => {
		clearTimeout(poll);
		if (active && visible())
			poll = setTimeout(() => {
				void check("poll");
				schedule();
			}, 60_000);
	};
	const resume = () => {
		if (visible()) void check("resume");
		schedule();
	};
	const online = () => {
		if (visible()) void check("online");
	};
	const consumeReceipt = () => {
		try {
			const raw = sessionStorage.getItem(UPDATE_RECEIPT_KEY);
			sessionStorage.removeItem(UPDATE_RECEIPT_KEY);
			if (!raw || raw.length > 512) return;
			const value = JSON.parse(raw);
			const age = Date.now() - value.at;
			if (
				typeof value.target !== "string" ||
				!HASH.test(value.target) ||
				typeof value.from !== "string" ||
				!HASH.test(value.from) ||
				!Number.isFinite(value.at) ||
				age < 0 ||
				age > RECEIPT_LIFETIME
			)
				return;
			emit("reload-outcome", value.target, "boot", {
				previous_commit: value.from,
				outcome:
					running === value.target
						? "target-loaded"
						: running === value.from
							? "previous-build-loaded"
							: "different-build-loaded",
			});
		} catch {
			/* Storage access must not block startup. */
		}
	};
	return {
		check,
		start() {
			if (active) return;
			active = true;
			lifecycle++;
			consumeReceipt();
			document.addEventListener("visibilitychange", resume);
			window.addEventListener("pageshow", resume);
			window.addEventListener("online", online);
			if (visible()) void check("boot");
			schedule();
		},
		stop() {
			active = false;
			lifecycle++;
			clearTimeout(poll);
			controller?.abort();
			document.removeEventListener("visibilitychange", resume);
			window.removeEventListener("pageshow", resume);
			window.removeEventListener("online", online);
		},
		boundary(key: string, fields: Fields) {
			details = fields;
			if (key === boundary) return;
			const previous = boundary;
			boundary = key;
			if (previous === null) return;
			const { offered, minimized } = store.getState();
			if (offered && minimized) {
				deferred.delete(offered);
				store.setState({ minimized: false });
				emit("prompt-shown", offered, "boundary");
			}
			if (visible()) void check("boundary");
		},
		defer() {
			const { offered, minimized } = store.getState();
			if (!offered || minimized) return;
			remember(deferred, offered);
			store.setState({ minimized: true });
			emit("deferred", offered, "user");
		},
		expand() {
			const { offered, minimized } = store.getState();
			if (!offered || !minimized) return;
			deferred.delete(offered);
			store.setState({ minimized: false });
			emit("prompt-shown", offered, "user");
		},
		async prepareReload() {
			if (pending) await pending;
			store.setState({ error: null });
			const target = await check("reload");
			if (!target) return false;
			if (target === running) {
				store.setState({
					error: "You are already running the current version.",
				});
				return false;
			}
			emit("reload-requested", target, "user");
			try {
				sessionStorage.setItem(
					UPDATE_RECEIPT_KEY,
					JSON.stringify({ from: running, target, at: Date.now() }),
				);
			} catch {
				emit("receipt-unavailable", target, "user");
			}
			return true;
		},
	};
}

export const buildUpdates = createBuildUpdateDetector({
	running: __BUILD_INFO__.commitHash,
	environment: () => getRuntimeConfig().environment,
});
