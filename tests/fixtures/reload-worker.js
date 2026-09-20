// Test-only legacy worker. Served by local test runners; never in the release image.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
	event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
	if (new URL(event.request.url).pathname === "/__reload-probe") {
		event.respondWith(new Response("legacy-worker"));
	} else if (event.request.mode === "navigate") {
		event.respondWith(
			caches.match("/").then((cached) => cached || fetch(event.request)),
		);
	}
});
