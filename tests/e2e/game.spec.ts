import {
	test as base,
	expect,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import ports from "../../local-ports.json" with { type: "json" };
import { copyFile, rm } from "node:fs/promises";

function watchApplicationErrors(context: BrowserContext, errors: string[]) {
	const watch = (page: Page) => {
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			// Browser transport/CSP diagnostics have no JavaScript arguments.
			// Application console.error calls must fail even if the UI recovers.
			if (message.type() === "error" && message.args().length > 0)
				errors.push(message.text());
		});
	};
	context.pages().forEach(watch);
	context.on("page", watch);
}
const test = base.extend<{ applicationErrors: string[] }>({
	applicationErrors: [
		async ({ context }, use) => {
			const errors: string[] = [];
			watchApplicationErrors(context, errors);
			await use(errors);
			expect(errors, "Unexpected application errors").toEqual([]);
		},
		{ auto: true },
	],
});
async function home(page: Page) {
	// Gameplay tests use a returning player. The delayed iPad install prompt
	// can otherwise appear between pointer-down/up and swallow the first click.
	await page.addInitScript((appOrigin) => {
		// Init scripts also run in Firebase's sandboxed polling iframe.
		if (window.top !== window || location.origin !== appOrigin) return;
		localStorage.setItem("pwaInstallDismissed", "true");
	}, new URL(test.info().project.use.baseURL!).origin);
	await page.addLocatorHandler(
		page.getByRole("button", { name: /continue anyway/i }),
		async (button) => {
			await button.click();
		},
	);
	await page.goto("/");
	const mobile = page.getByRole("button", { name: /continue anyway/i });
	if (await mobile.isVisible()) await mobile.click();
}
const card = (page: Page, id: number) =>
	page.locator(`main button[data-card-id="card-${id}"]:enabled`);
async function match(page: Page, id: number) {
	await card(page, id).click();
	await card(page, id + 1).click();
	await expect(card(page, id)).toHaveCount(0);
}
async function localRequestsOnly(context: BrowserContext) {
	await context.route("**/*", (route) => {
		const requestUrl = new URL(route.request().url());
		const url =
			requestUrl.protocol === "blob:" ? new URL(requestUrl.origin) : requestUrl;
		if (
			!["127.0.0.1", "localhost"].includes(url.hostname) &&
			url.protocol !== "data:"
		)
			throw new Error(`Unexpected external request: ${url.origin}`);
		return route.continue();
	});
}
type DiagnosticRow = {
	message: string;
	context: Record<string, string | number | boolean | null>;
};
async function diagnostics(page: Page): Promise<DiagnosticRow[]> {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const request = indexedDB.open("matchimus-logs");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const logs = db.transaction("logs").objectStore("logs").getAll();
					logs.onerror = () => {
						db.close();
						reject(logs.error);
					};
					logs.onsuccess = () => {
						db.close();
						resolve(logs.result.filter((row) => row.message.startsWith("mm.")));
					};
				};
			}),
	);
}
async function expectFlipDiagnostics(host: Page, guest: Page) {
	await expect
		.poll(async () => {
			const [h, g] = await Promise.all([diagnostics(host), diagnostics(guest)]);
			const write = h.find(
				(row) =>
					row.message === "mm.sync.write.result" &&
					row.context.ok === true &&
					row.context.context === "flip:card-0",
			);
			if (!write) return false;
			const version = write.context.sync_version,
				round = write.context.game_round;
			const click = h.find(
				(row) =>
					row.message === "mm.input.click" &&
					row.context.card_id === "card-0" &&
					row.context.input_id === write.context.input_id,
			);
			const matching = (row: DiagnosticRow) =>
				row.context.sync_version === version &&
				row.context.game_round === round;
			return Boolean(
				click &&
					h.some(
						(row) =>
							row.message === "mm.input.pointer" &&
							row.context.phase === "down" &&
							row.context.gesture_id === click.context.gesture_id,
					) &&
					g.some(
						(row) =>
							row.message === "mm.sync.snapshot.gate" &&
							row.context.decision === "accepted" &&
							matching(row),
					) &&
					g.some(
						(row) =>
							row.message === "mm.render.painted" &&
							row.context.phase === "after-frame-task" &&
							matching(row),
					) &&
					[h, g].every((rows) =>
						["browser", "rtdb", "opponent"].every((source) =>
							rows.some(
								(row) =>
									row.message === "mm.conn.input" &&
									row.context.game_round === round &&
									row.context.source === source,
							),
						),
					),
			);
		})
		.toBe(true);
}
test.beforeEach(async ({ context }) => localRequestsOnly(context));
test.beforeAll(async () => {
	if (process.env.E2E_SERVER !== "container")
		await copyFile(
			"tests/fixtures/reload-worker.js",
			"dist/__reload-test-worker.js",
		);
});
test.afterAll(async () => {
	if (process.env.E2E_SERVER !== "container")
		await rm("dist/__reload-test-worker.js", { force: true });
});

test("Reload App removes a controlling legacy worker and cached app while preserving saved data", async ({
	page,
}) => {
	await home(page);
	const deviceId = await page.evaluate(() =>
		localStorage.getItem("matchimus-device-id"),
	);
	expect(deviceId).toMatch(/^[a-f0-9-]{36}$/);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Promise<boolean>((resolve, reject) => {
						const request = indexedDB.open("matchimus-logs");
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const db = request.result;
							const logs = db.transaction("logs").objectStore("logs").getAll();
							logs.onerror = () => reject(logs.error);
							logs.onsuccess = () => {
								db.close();
								resolve(
									logs.result.some(
										(entry) =>
											entry.message === "mm.session.start" &&
											entry.context.environment === "emulator" &&
											entry.context.device_id ===
												localStorage.getItem("matchimus-device-id"),
									),
								);
							};
						};
					}),
			),
		)
		.toBe(true);
	await page.evaluate(async () => {
		localStorage.setItem("reload-saved-setting", "keep-me");
		document.cookie = "reload-session=keep-me; SameSite=Strict; path=/";
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open("reload-saved-data", 1);
			request.onupgradeneeded = () =>
				request.result.createObjectStore("settings");
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const db = request.result;
				const tx = db.transaction("settings", "readwrite");
				tx.objectStore("settings").put("keep-me", "player");
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
		});
		const cache = await caches.open("matchimus-legacy-test");
		await cache.put(
			"/",
			new Response("<html><body>Obsolete cached app</body></html>", {
				headers: { "Content-Type": "text/html" },
			}),
		);
		await navigator.serviceWorker.register("/__reload-test-worker.js", {
			scope: "/",
		});
		await navigator.serviceWorker.ready;
	});
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
	expect(
		await page.evaluate(async () => (await fetch("/__reload-probe")).text()),
	).toBe("legacy-worker");
	await page.getByRole("button", { name: "Reload App", exact: true }).click();
	const navigation = page.waitForResponse(
		(response) =>
			response.request().isNavigationRequest() &&
			new URL(response.url()).searchParams.has("_matchimus_reload"),
	);
	await page
		.getByRole("button", { name: "Clear Cache & Reload", exact: true })
		.click();
	const response = await navigation;
	expect(response.fromServiceWorker()).toBe(false);
	if (process.env.E2E_SERVER === "container") {
		const headers = await response.allHeaders();
		expect(headers["cache-control"]).toBe("no-store");
		expect(headers["clear-site-data"]).toBe('"cache"');
	}
	await expect(
		page.getByRole("button", { name: /Play Online Challenge/ }),
	).toBeVisible();
	await expect(page).toHaveURL(test.info().project.use.baseURL + "/");
	expect(
		await page.evaluate(async () => ({
			workers: (await navigator.serviceWorker.getRegistrations()).length,
			controller: navigator.serviceWorker.controller !== null,
			caches: await caches.keys(),
			deviceId: localStorage.getItem("matchimus-device-id"),
			setting: localStorage.getItem("reload-saved-setting"),
			cookie: document.cookie.includes("reload-session=keep-me"),
			indexedSetting: await new Promise((resolve, reject) => {
				const request = indexedDB.open("reload-saved-data", 1);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const read = db
						.transaction("settings")
						.objectStore("settings")
						.get("player");
					read.onsuccess = () => {
						db.close();
						resolve(read.result);
					};
					read.onerror = () => reject(read.error);
				};
			}),
		})),
	).toEqual({
		workers: 0,
		controller: false,
		caches: [],
		deviceId,
		setting: "keep-me",
		cookie: true,
		indexedSetting: "keep-me",
	});
});

test("complete a local game using keyboard and pointer, then replay", async ({
	page,
}) => {
	await home(page);
	await page.getByRole("button", { name: /Same Device Play/ }).click();
	await page.getByRole("button", { name: /Dinosaur Adventure Travel/ }).click();
	await page.getByRole("button", { name: "4 4×2 Easy" }).click();
	await page
		.getByRole("button", { name: "🎮 Start Game", exact: true })
		.click();
	await expect(page).toHaveURL(/\/local\/game$/);
	await card(page, 0).focus();
	await page.keyboard.press("Enter");
	await expect(card(page, 0)).toHaveAttribute("aria-pressed", "true");
	await card(page, 1).click();
	await expect(card(page, 0)).toHaveCount(0);
	for (const id of [2, 4, 6]) await match(page, id);
	await expect(page).toHaveURL(/\/game-over$/);
	await expect(page.getByText(/wins/i).first()).toBeVisible();
	await page.getByRole("button", { name: /play again/i }).click();
	await page.getByRole("button", { name: /replay/i }).click();
	await expect(page).toHaveURL(/\/local\/game$/);
	await expect(page.locator("main button[data-card-id]:enabled")).toHaveCount(
		8,
	);
});
test("two simultaneous touch contacts flip on down once, then mouse and keyboard still work", async ({
	page,
}) => {
	await home(page);
	await page.getByRole("button", { name: /Same Device Play/ }).click();
	await page.getByRole("button", { name: /Dinosaur Adventure Travel/ }).click();
	await page.getByRole("button", { name: "4 4×2 Easy" }).click();
	await page
		.getByRole("button", { name: "🎮 Start Game", exact: true })
		.click();
	await expect(page).toHaveURL(/\/local\/game$/);
	// Dispatch both downs in one task. WebKit exposes no public multi-touch
	// injection API; this tests real React/game handlers, not OS click synthesis.
	await page.evaluate(() => {
		for (const [index, id] of [0, 2].entries()) {
			const target = document.querySelector(
				'main button[data-card-id="card-' + id + '"]',
			)!;
			target.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					pointerId: index + 10,
					pointerType: "touch",
					isPrimary: index === 0,
					button: 0,
					clientX: 10,
					clientY: 20,
				}),
			);
		}
	});
	await expect(card(page, 0)).toHaveAttribute("aria-pressed", "true");
	await expect(card(page, 2)).toHaveAttribute("aria-pressed", "true");
	await page.evaluate(() => {
		for (const [index, id] of [2, 0].entries()) {
			const target = document.querySelector(
				'main button[data-card-id="card-' + id + '"]',
			)!;
			target.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					pointerId: index === 0 ? 11 : 10,
					pointerType: "touch",
					button: 0,
					clientX: 10,
					clientY: 20,
				}),
			);
			// Explicit MouseEvent exercises WebKit's ID-less compatibility click path.
			target.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					detail: 1,
					clientX: 10,
					clientY: 20,
				}),
			);
		}
	});
	await expect
		.poll(
			async () =>
				(await diagnostics(page)).filter(
					(row) => row.message === "mm.game.flip",
				).length,
		)
		.toBe(2);
	await expect
		.poll(
			async () =>
				(await diagnostics(page)).filter(
					(row) =>
						row.message === "mm.input.click" &&
						row.context.activation_suppressed === true,
				).length,
		)
		.toBe(2);
	await expect(card(page, 0)).toHaveAttribute("aria-pressed", "false");
	await expect(card(page, 2)).toHaveAttribute("aria-pressed", "false");
	await card(page, 0).click(); // real mouse sequence replaces last touch identity
	await card(page, 1).focus();
	await page.keyboard.press("Space");
	await expect(card(page, 0)).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(await diagnostics(page)).filter(
					(row) => row.message === "mm.game.flip",
				).length,
		)
		.toBe(4);
	const activations = (await diagnostics(page)).filter(
		(row) => row.message === "mm.input.activation",
	);
	expect(activations.map((row) => row.context.source)).toEqual([
		"pointerdown",
		"pointerdown",
		"pointerdown",
		"click",
	]);
	expect(new Set(activations.map((row) => row.context.input_id)).size).toBe(4);
	if (test.info().project.name === "webkit") {
		await card(page, 2).tap();
		await card(page, 3).tap();
		await expect(card(page, 2)).toHaveCount(0);
		await expect
			.poll(
				async () =>
					(await diagnostics(page)).filter(
						(row) => row.message === "mm.game.flip",
					).length,
			)
			.toBe(6);
		const native = (await diagnostics(page))
			.filter((row) => row.message === "mm.input.activation")
			.slice(-2);
		expect(native.map((row) => row.context.source)).toEqual([
			"pointerdown",
			"pointerdown",
		]);
	}
});

test("primary mouse press flips before release, drag-off stays flipped, keyboard remains native", async ({
	page,
	context,
}) => {
	await localRequestsOnly(context);
	await home(page);
	await page.getByRole("button", { name: /Same Device Play/ }).click();
	await page.getByRole("button", { name: /Dinosaur Adventure Travel/ }).click();
	await page.getByRole("button", { name: "4 4×2 Easy" }).click();
	await page
		.getByRole("button", { name: "🎮 Start Game", exact: true })
		.click();
	await expect(page).toHaveURL(/\/local\/game$/);
	for (const button of ["middle", "right"] as const) {
		await card(page, 0).click({ button });
		await expect(card(page, 0)).toHaveAttribute("aria-pressed", "false");
	}
	await card(page, 0).hover();
	await page.mouse.down();
	await expect(card(page, 0)).toHaveAttribute("aria-pressed", "true");
	await page.mouse.up();
	await card(page, 1).focus();
	await page.keyboard.press("Enter");
	await expect(card(page, 0)).toHaveCount(0);
	await card(page, 2).hover();
	await page.mouse.down();
	await expect(card(page, 2)).toHaveAttribute("aria-pressed", "true");
	await page.mouse.move(1, 1);
	await page.mouse.up();
	await expect(card(page, 2)).toHaveAttribute("aria-pressed", "true");
	await card(page, 3).focus();
	await page.keyboard.press("Space");
	await expect(card(page, 2)).toHaveCount(0);
	await match(page, 4);
	await card(page, 6).focus();
	await page.keyboard.press("Enter");
	await card(page, 7).focus();
	await page.keyboard.press("Space");
	await expect(page).toHaveURL(/\/game-over$/);
	await expect
		.poll(
			async () =>
				(await diagnostics(page)).filter(
					(row) => row.message === "mm.game.flip",
				).length,
		)
		.toBe(8);
	const events = await diagnostics(page);
	const activations = events.filter(
		(row) => row.message === "mm.input.activation",
	);
	expect(activations.map((row) => row.context.source)).toEqual([
		"pointerdown",
		"click",
		"pointerdown",
		"click",
		"pointerdown",
		"pointerdown",
		"click",
		"click",
	]);
	expect(new Set(activations.map((row) => row.context.input_id)).size).toBe(8);
	expect(
		events
			.filter((row) => row.message === "mm.game.flip")
			.every((row) => row.context.result === "accepted"),
	).toBe(true);
	expect(
		events
			.filter(
				(row) =>
					row.message === "mm.input.click" &&
					row.context.pointer_type === "mouse",
			)
			.every((row) => row.context.activation_suppressed === true),
	).toBe(true);
});

test("a flying matched card cannot intercept a press on the next playable card", async ({
	page,
	context,
}) => {
	await localRequestsOnly(context);
	await home(page);
	await page.getByRole("button", { name: /Same Device Play/ }).click();
	await page.getByRole("button", { name: /Dinosaur Adventure Travel/ }).click();
	await page.getByRole("button", { name: "20 8×5 Hard" }).click();
	await page
		.getByRole("button", { name: "🎮 Start Game", exact: true })
		.click();
	const board = page.getByRole("application", { name: "Game board" });
	await expect(board).toBeVisible();
	await board.evaluate(async (e) => {
		await Promise.allSettled(
			e.getAnimations({ subtree: true }).map((a) => a.finished),
		);
	});
	const bottom = await board.locator("button[data-card-id]").evaluateAll(
		(nodes) =>
			nodes
				.map((n) => ({
					id: Number(n.getAttribute("data-card-id")!.split("-")[1]),
					y: n.getBoundingClientRect().bottom,
				}))
				.sort((a, b) => b.y - a.y)[0].id,
	);
	await card(page, bottom).click();
	await card(page, bottom ^ 1).click();
	await expect(page.locator(".card-fly-to-player").first()).toBeVisible();
	// Find a real flight crossing a playable card, then hold that animation frame
	// to deliver native input deterministically through the visual decoration.
	const point = await page.evaluate(async () => {
		const end = performance.now() + 2000;
		while (performance.now() < end) {
			await new Promise(requestAnimationFrame);
			const flights = [...document.querySelectorAll(".card-fly-to-player")];
			for (const card of document.querySelectorAll(
				'main [role="application"] button[data-card-id]:enabled',
			)) {
				const c = card.getBoundingClientRect(),
					x = c.x + c.width / 2,
					y = c.y + c.height / 2;
				if (
					flights.some((f) => {
						const r = f.getBoundingClientRect();
						return (
							x > r.left + 8 &&
							x < r.right - 8 &&
							y > r.top + 8 &&
							y < r.bottom - 8
						);
					})
				) {
					for (const f of flights)
						for (const a of f.getAnimations({ subtree: true })) a.pause();
					return {
						x,
						y,
						id: Number(card.getAttribute("data-card-id")!.split("-")[1]),
					};
				}
			}
		}
		throw Error("No flight crossed a playable card");
	});
	if (test.info().project.name === "webkit")
		await page.touchscreen.tap(point.x, point.y);
	else await page.mouse.click(point.x, point.y);
	await expect(card(page, point.id)).toHaveAttribute("aria-pressed", "true");
	await expect
		.poll(async () =>
			(await diagnostics(page)).some(
				(r) =>
					r.message === "mm.input.capture" &&
					r.context.event_type === "pointerdown" &&
					r.context.target_card_id === "card-" + point.id &&
					r.context.card_handler_ran === true,
			),
		)
		.toBe(true);
});

test("staggered contacts reach both cards during the first flip", async ({
	page,
	context,
}) => {
	await localRequestsOnly(context);
	await home(page);
	await page.getByRole("button", { name: /Same Device Play/ }).click();
	await page.getByRole("button", { name: /Dinosaur Adventure Travel/ }).click();
	await page.getByRole("button", { name: "8 4×4 Medium" }).click();
	await page
		.getByRole("button", { name: "🎮 Start Game", exact: true })
		.click();
	const board = page.getByRole("application", { name: "Game board" });
	await expect(board).toBeVisible();
	await board.evaluate(async (e) => {
		await Promise.allSettled(
			e.getAnimations({ subtree: true }).map((a) => a.finished),
		);
	});
	const cdp =
		test.info().project.name === "chromium"
			? await context.newCDPSession(page)
			: null;
	if (cdp)
		await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	let id = 0;
	for (const pattern of ["overlap", "just-up"])
		for (const delay of [60, 120, 200, 300]) {
			const a = await card(page, id).boundingBox(),
				b = await card(page, id + 1).boundingBox();
			if (!a || !b) throw Error("Missing staggered pair");
			const points = [
				{ id: 1, x: a.x + a.width / 2, y: a.y + a.height / 2 },
				{ id: 2, x: b.x + b.width / 2, y: b.y + b.height / 2 },
			];
			if (cdp) {
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [points[0]],
				});
				if (pattern === "just-up") {
					await page.waitForTimeout(30);
					await cdp.send("Input.dispatchTouchEvent", {
						type: "touchEnd",
						touchPoints: [],
					});
					await page.waitForTimeout(delay - 30);
				} else await page.waitForTimeout(delay);
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: pattern === "overlap" ? points : [points[1]],
				});
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchEnd",
					touchPoints: [],
				});
			} else if (pattern === "just-up") {
				// Native WebKit taps include the browser's pointer/touch/click synthesis.
				await page.touchscreen.tap(points[0].x, points[0].y);
				await page.waitForTimeout(delay);
				await page.touchscreen.tap(points[1].x, points[1].y);
			} else {
				// WebKit's driver exposes only complete taps. This overlapping case
				// injects contacts through real hit-testing, not iOS gesture recognition.
				await page.evaluate(
					async ({ points, delay }) => {
						const targets = points.map(
							(p) => document.elementFromPoint(p.x, p.y)!,
						);
						const send = (n: number, type: string, target: Element) => {
							const p = points[n];
							target.dispatchEvent(
								new PointerEvent(type, {
									bubbles: true,
									cancelable: true,
									pointerType: "touch",
									pointerId: p.id,
									button: 0,
									isPrimary: n === 0,
									clientX: p.x,
									clientY: p.y,
								}),
							);
						};
						send(0, "pointerdown", targets[0]);
						await new Promise((r) => setTimeout(r, delay));
						send(
							1,
							"pointerdown",
							document.elementFromPoint(points[1].x, points[1].y)!,
						);
						send(0, "pointerup", targets[0]);
						send(1, "pointerup", targets[1]);
					},
					{ points, delay },
				);
			}
			await expect(card(page, id)).toHaveAttribute("aria-pressed", "true");
			await expect(card(page, id + 1)).toHaveAttribute("aria-pressed", "true");
			await expect(card(page, id)).toHaveCount(0);
			id += 2;
		}
	await expect(page).toHaveURL(/\/game-over$/);
	await expect
		.poll(
			async () =>
				(await diagnostics(page)).filter((r) => r.message === "mm.game.flip")
					.length,
		)
		.toBe(16);
	const events = await diagnostics(page);
	expect(
		events
			.filter((r) => r.message === "mm.game.flip")
			.every((r) => r.context.result === "accepted"),
	).toBe(true);
	const captures = events.filter(
		(r) =>
			r.message === "mm.input.capture" &&
			r.context.event_type === "pointerdown",
	);
	expect(captures).toHaveLength(16);
	expect(
		captures.every(
			(r) =>
				r.context.card_handler_ran === true &&
				r.context.target_card_id === r.context.hit_card_id,
		),
	).toBe(true);
	if (cdp) await cdp.detach();
});

test("named players start a 16-pair Thanksgiving game with strict rules", async ({
	browser,
	page: host,
	applicationErrors,
}) => {
	const guestContext = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		...test.info().project.use,
	});
	watchApplicationErrors(guestContext, applicationErrors);
	await localRequestsOnly(guestContext);
	try {
		const guest = await guestContext.newPage();
		await home(host);
		await host.getByRole("button", { name: /Play Online Challenge/ }).click();
		await host.getByLabel("Your online name").fill("Nate");
		await host.getByRole("button", { name: /create.*room/i }).click();
		await expect(host).toHaveURL(/\/online\/waiting$/);
		await host.getByRole("button", { name: /Choose Theme/ }).click();
		await host.getByRole("button", { name: /Thanksgiving Feast/ }).click();
		await host.getByRole("button", { name: /40.*cards/i }).click();
		await host.getByRole("button", { name: /^16 .*Hard$/ }).click();
		const code = (await host.getByTestId("room-code").textContent())!.trim();
		await home(guest);
		await guest.getByRole("button", { name: /Play Online Challenge/ }).click();
		await guest.getByLabel("Your online name").fill("Nora");
		await guest.getByRole("button", { name: /join.*room/i }).click();
		await guest.getByPlaceholder("ABCD").fill(code);
		await guest.getByRole("button", { name: "Join Game", exact: true }).click();
		await expect(guest).toHaveURL(/\/online\/waiting$/);
		await expect(host.getByText("Nora", { exact: true })).toBeVisible();
		await expect(guest.getByText("Nate", { exact: true })).toBeVisible();
		await host.getByRole("button", { name: "Start Game", exact: true }).click();
		for (const page of [host, guest]) {
			await expect(page).toHaveURL(/\/online\/game$/);
			await expect(
				page.locator("main button[data-card-id]:enabled"),
			).toHaveCount(32);
			await expect(
				page.locator('main img[src*="/deck-images/thanksgiving/"]'),
			).toHaveCount(32);
		}
		await card(host, 0).click();
		await expect(card(guest, 0)).toHaveAttribute("aria-pressed", "true");
		await card(host, 1).click();
		await expect(card(host, 0)).toHaveCount(0);
		await expect(card(guest, 0)).toHaveCount(0);
	} finally {
		await guestContext.close();
	}
});

for (const transport of ["default", "polling"] as const) {
	test(`two isolated players synchronize, pause, reconnect and replay (${transport})`, async ({
		browser,
		page: host,
		applicationErrors,
	}) => {
		const guestContext = await browser.newContext({
			baseURL: test.info().project.use.baseURL,
		});
		const guest = await guestContext.newPage();
		watchApplicationErrors(guestContext, applicationErrors);
		await localRequestsOnly(guestContext);
		let usedPolling = false;
		if (transport === "polling") {
			// Exercise Firebase's real HTTP transport after a failed socket handshake.
			await guestContext.routeWebSocket(
				(url) =>
					url.hostname === "127.0.0.1" && url.port === String(ports.database),
				(socket) => socket.close(),
			);
			guest.on("response", (response) => {
				const url = new URL(response.url());
				if (
					url.port === String(ports.database) &&
					url.pathname === "/.lp" &&
					response.ok()
				)
					usedPolling = true;
			});
		}
		try {
			await home(host);
			await host.getByRole("button", { name: /Play Online Challenge/ }).click();
			await host.getByRole("button", { name: /create.*room/i }).click();

			await expect(host).toHaveURL(/\/online\/waiting$/);
			await host.getByRole("button", { name: /40.*cards/i }).click();
			await host.getByRole("button", { name: "4 4×2 Easy" }).click();
			const code = (await host
				.locator('[data-testid="room-code"]')
				.textContent())!.trim();
			await home(guest);
			await guest
				.getByRole("button", { name: /Play Online Challenge/ })
				.click();
			await guest.getByRole("button", { name: /join.*room/i }).click();
			await guest.getByPlaceholder("ABCD").fill(code);
			await guest
				.getByRole("button", { name: "Join Game", exact: true })
				.click();
			await expect(guest).toHaveURL(/\/online\/waiting$/);
			await host.getByRole("button", { name: /start game/i }).click();
			await expect(host).toHaveURL(/\/online\/game$/);
			await expect(guest).toHaveURL(/\/online\/game$/);
			await card(host, 0).click();
			await expect(card(guest, 0)).toHaveAttribute("aria-pressed", "true");
			if (transport === "default") await expectFlipDiagnostics(host, guest);
			await guestContext.setOffline(true);
			await expect(
				guest.getByRole("heading", { name: "Game paused" }),
			).toBeVisible();
			await guestContext.setOffline(false);
			await expect(
				guest.getByRole("heading", { name: "Game paused" }),
			).toHaveCount(0);
			await expect(
				host.getByRole("heading", { name: "Game paused" }),
			).toHaveCount(0);
			await card(host, 1).click();
			await expect(card(guest, 0)).toHaveCount(0);
			const count = await host
				.locator("main button[data-card-id]:enabled")
				.count();
			for (let id = 2; id < count + 2; id += 2) await match(host, id);
			await expect(host).toHaveURL(/\/game-over$/);
			await expect(guest).toHaveURL(/\/game-over$/);
			if (transport === "default")
				await expect
					.poll(async () => {
						const rows = await diagnostics(host);
						return (
							rows.some(
								(row) =>
									row.message === "mm.sync.write.result" &&
									row.context.ok === true &&
									row.context.game_status === "finished",
							) &&
							rows.some(
								(row) =>
									row.message === "mm.game.finish_check" &&
									row.context.finished === true,
							) &&
							rows.some(
								(row) =>
									row.message === "mm.nav.results_timer" &&
									row.context.phase === "scheduled",
							) &&
							rows.some(
								(row) =>
									row.message === "mm.nav.results_timer" &&
									row.context.phase === "fired",
							) &&
							rows.some(
								(row) =>
									row.message === "mm.nav.route" &&
									row.context.path === "/game-over",
							)
						);
					})
					.toBe(true);
			await host.getByRole("button", { name: /play again/i }).click();
			await host.getByRole("button", { name: /replay/i }).click();
			await expect(host).toHaveURL(/\/online\/game$/);
			await expect(guest).toHaveURL(/\/online\/game$/);
			if (transport === "polling") expect(usedPolling).toBe(true);
		} finally {
			await guestContext.close();
		}
	});
}

test("Connection Test completes in the lobby and does not disconnect an active game", async ({
	browser,
	page: host,
	applicationErrors,
}) => {
	const guestContext = await browser.newContext({
		...test.info().project.use,
		baseURL: test.info().project.use.baseURL,
	});
	watchApplicationErrors(guestContext, applicationErrors);
	await localRequestsOnly(guestContext);
	const openTest = async (page: Page) => {
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await page
			.getByRole("button", { name: "⚡ Advanced", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Connection test", exact: true })
			.click();
		await page.getByRole("button", { name: "Start test", exact: true }).click();
	};
	try {
		await home(host);
		await host.getByRole("button", { name: /Play Online Challenge/ }).click();
		await host.getByRole("button", { name: /create.*room/i }).click();
		await expect(host).toHaveURL(/\/online\/waiting$/);
		await host.getByRole("button", { name: /40.*cards/i }).click();
		await host.getByRole("button", { name: "4 4×2 Easy" }).click();
		const code = (await host.getByTestId("room-code").textContent())!.trim();
		await openTest(host);
		await expect(host.getByText("A: Tap the card five times")).toBeVisible();
		const activate = async (name: string) => {
			const button = host.getByRole("button", { name, exact: true });
			if (test.info().project.use.hasTouch) await button.tap();
			else await button.click();
		};
		for (let i = 0; i < 5; i++) await activate("Tap");
		await activate("Continue");
		for (let pair = 1; pair <= 3; pair++) {
			await expect(
				host.getByText(`B: Tap left then right fast — pair ${pair} of 3`),
			).toBeVisible();
			await activate("Left");
			await activate("Right");
			await activate("Continue pair");
		}
		await expect(
			host.getByText("Test complete", { exact: true }),
		).toBeVisible();
		await expect
			.poll(async () => {
				const rows = await diagnostics(host);
				const results = rows.filter(
					(row) => row.message === "mm.conntest.result",
				);
				return (
					results.length === 8 &&
					results.every((row) => row.context.status === "ok") &&
					rows.some((row) => row.message === "mm.conntest.done")
				);
			})
			.toBe(true);
		await host.getByRole("button", { name: "Close modal" }).click();
		const guest = await guestContext.newPage();
		await home(guest);
		await guest.getByRole("button", { name: /Play Online Challenge/ }).click();
		await guest.getByRole("button", { name: /join.*room/i }).click();
		await guest.getByPlaceholder("ABCD").fill(code);
		await guest.getByRole("button", { name: "Join Game", exact: true }).click();
		await expect(guest).toHaveURL(/\/online\/waiting$/);
		await host.getByRole("button", { name: /start game/i }).click();
		await expect(guest).toHaveURL(/\/online\/game$/);
		await openTest(guest);
		await expect(guest.getByText("A: Tap the card five times")).toBeVisible();
		await card(host, 0).click();
		await expect(card(guest, 0)).toHaveAttribute("aria-pressed", "true");
		await guest
			.getByRole("button", { name: "Cancel test", exact: true })
			.click();
		await expect(
			guest.getByText("Test cancelled", { exact: true }),
		).toBeVisible();
		await guest.getByRole("button", { name: "Close modal" }).click();
		await card(host, 1).click();
		await expect(card(guest, 0)).toHaveCount(0);
		await expect(
			guest.getByText("Connection interrupted. Game paused.", { exact: true }),
		).toHaveCount(0);
	} finally {
		await guestContext.close();
	}
});
