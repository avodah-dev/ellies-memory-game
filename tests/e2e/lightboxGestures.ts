import { expect, test, type Page } from "@playwright/test";

type GestureEvidence = {
	type: string;
	trusted: boolean;
	time: number;
	target: string;
	touches: { id: number; x: number; y: number }[];
	changed: { id: number; x: number; y: number }[];
	visibility: string;
	cards: { transform: string; transition: string; text: string | null }[];
};

// Pinned Playwright 1.63 WebKit protocol. This uses the browser input agent,
// not DOM dispatchEvent; the assertions below require trusted touch events.
// Source: microsoft/playwright v1.63.0 browser_patches/webkit/patches/bootstrap.diff.
type WebKitPage = {
	_connection: {
		toImpl(page: Page): {
			delegate: {
				_pageProxySession: {
					send(method: string, params: object): Promise<unknown>;
				};
			};
		};
	};
};
export async function expectLightboxNavigation(page: Page, browser: string) {
	const display = page.getByRole("region", { name: "Card display" });
	const heading = display.getByRole("heading");
	await expect(heading).toHaveCount(1);
	const first = await heading.innerText();
	await display.evaluate((el) => {
		const target = el as HTMLElement & {
			recordedTouches: GestureEvidence[];
		};
		target.recordedTouches = [];
		for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"])
			el.addEventListener(type, (event) => {
				const touch = event as TouchEvent;
				const points = (list: TouchList) =>
					Array.from(list, (p) => ({
						id: p.identifier,
						x: p.clientX,
						y: p.clientY,
					}));
				target.recordedTouches.push({
					type: event.type,
					trusted: event.isTrusted,
					time: performance.now(),
					target: (event.target as Element).tagName,
					touches: points(touch.touches),
					changed: points(touch.changedTouches),
					visibility: document.visibilityState,
					cards: Array.from(el.children, (child) => {
						const style = getComputedStyle(child);
						return {
							transform: style.transform,
							transition: style.transition,
							text: child.querySelector("h2")?.textContent ?? null,
						};
					}),
				});
			});
	});
	const chromium =
		browser === "chromium" ? await page.context().newCDPSession(page) : null;
	const webkit =
		browser === "webkit"
			? (page as unknown as WebKitPage)._connection.toImpl(page).delegate
					._pageProxySession
			: null;
	const send = async (type: string, x: number, y: number) => {
		const point = { x: Math.round(x), y: Math.round(y), id: 1 };
		if (chromium)
			await chromium.send("Input.dispatchTouchEvent", {
				type: type as "touchStart" | "touchMove" | "touchEnd",
				touchPoints: type === "touchEnd" ? [] : [point],
			});
		else if (webkit)
			await webkit.send("Input.dispatchTouchEvent", {
				type,
				touchPoints: [point],
				modifiers: 0,
			});
		else
			throw Error(
				"Native gesture driver is defined only for Chromium and WebKit",
			);
	};
	const swipe = async (direction: 1 | -1) => {
		const box = await display.boundingBox();
		if (!box) throw Error("Lightbox has no bounds");
		const start = box.x + box.width * (direction === -1 ? 0.85 : 0.15),
			y = box.y + box.height * 0.45;
		await send("touchStart", start, y);
		for (let step = 1; step <= 2; step++) {
			await send(
				"touchMove",
				start + (direction * box.width * 0.7 * step) / 2,
				y,
			);
			// Two native motion checkpoints; travel exceeds the distance threshold.
			// CI input acknowledgements can be slow, so do not depend on flick velocity.
			await page.waitForTimeout(16);
		}
		await send("touchEnd", start + direction * box.width * 0.7, y);
		await expect(heading).toHaveCount(1);
	};
	try {
		await swipe(-1);
		await expect(heading).not.toHaveText(first);
		const second = await heading.innerText();
		await swipe(1);
		await expect(heading).toHaveText(first);
		await page.getByRole("button", { name: "Next card", exact: true }).click();
		await expect(heading).toHaveCount(1);
		await expect(heading).toHaveText(second);
		await page
			.getByRole("button", { name: "Previous card", exact: true })
			.click();
		await expect(heading).toHaveCount(1);
		await expect(heading).toHaveText(first);
		await page.keyboard.press("ArrowRight");
		await expect(heading).toHaveCount(1);
		await expect(heading).toHaveText(second);
		await page.keyboard.press("ArrowLeft");
		await expect(heading).toHaveCount(1);
		await expect(heading).toHaveText(first);
		const events = await display.evaluate(
			(el) =>
				(
					el as HTMLElement & {
						recordedTouches: { type: string; trusted: boolean }[];
					}
				).recordedTouches,
		);
		expect(events.filter((e) => e.type === "touchstart")).toHaveLength(2);
		expect(events.filter((e) => e.type === "touchend")).toHaveLength(2);
		expect(events.some((e) => e.type === "touchmove")).toBe(true);
		expect(events.every((e) => e.trusted)).toBe(true);
		expect(events.filter((e) => e.type === "touchcancel")).toHaveLength(0);
	} finally {
		await test.info().attach("native-lightbox-gestures", {
			body: JSON.stringify(
				await display.evaluate(
					(el) =>
						(el as HTMLElement & { recordedTouches: GestureEvidence[] })
							.recordedTouches,
				),
			),
			contentType: "application/json",
		});
		await chromium?.detach();
	}
}
