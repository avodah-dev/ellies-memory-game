import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import ports from "../../local-ports.json" with { type: "json" };
async function home(page: Page) {
	await page.addLocatorHandler(
		page.getByRole("button", { name: "Got it!", exact: true }),
		async (button) => {
			await button.click();
		},
	);
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
test.beforeEach(async ({ context }) => localRequestsOnly(context));
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
for (const transport of ["default", "polling"] as const) {
	test(`two isolated players synchronize, pause, reconnect and replay (${transport})`, async ({
		browser,
		page: host,
	}) => {
		const guestContext = await browser.newContext({
			baseURL: test.info().project.use.baseURL,
		});
		const guest = await guestContext.newPage();
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
