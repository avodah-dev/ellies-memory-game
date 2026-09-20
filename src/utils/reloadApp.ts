import { RELOAD_QUERY } from "../../shared/reload";

async function attemptCleanup(action: () => Promise<unknown>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve().then(action),
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Cache cleanup timed out")),
					3000,
				);
			}),
		]);
	} catch (error) {
		// Browser privacy settings can deny storage access. Still perform the
		// explicit network navigation; one unavailable API must not trap the UI.
		console.warn("Reload could not clear some cached app data", error);
	} finally {
		clearTimeout(timer);
	}
}

export async function reloadApp() {
	// Stop workers before clearing their caches so they cannot refill them
	// during cleanup. Registrations and Cache Storage are scoped to this origin.
	await attemptCleanup(async () => {
		if (!("serviceWorker" in navigator)) return;
		const registrations = await navigator.serviceWorker.getRegistrations();
		const results = await Promise.allSettled(
			registrations.map((r) => r.unregister()),
		);
		if (results.some((r) => r.status === "rejected"))
			throw new Error("Some service workers could not be removed");
	});
	await attemptCleanup(async () => {
		if (!("caches" in window)) return;
		const names = await window.caches.keys();
		const results = await Promise.allSettled(
			names.map((name) => window.caches.delete(name)),
		);
		if (results.some((r) => r.status === "rejected"))
			throw new Error("Some app caches could not be removed");
	});
	// Keep cookies, localStorage and IndexedDB (settings and Firebase identity).
	// The server returns Clear-Site-Data: "cache" for this explicit navigation.
	const url = new URL("/", window.location.origin);
	url.searchParams.set(RELOAD_QUERY, crypto.randomUUID());
	window.location.replace(url.href);
}

export function consumeReloadMarker() {
	const url = new URL(window.location.href);
	if (!url.searchParams.has(RELOAD_QUERY)) return;
	url.searchParams.delete(RELOAD_QUERY);
	window.history.replaceState(window.history.state, "", url.href);
}
