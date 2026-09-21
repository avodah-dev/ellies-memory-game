import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../../shared/runtimeConfig";
import { markCardInput, startInputCapture } from "./inputCapture";
import { track } from "./core";
vi.mock("./core", () => ({ track: vi.fn() }));
const config = {
	environment: "emulator",
	telemetry: "on",
	firebase: null,
} as RuntimeConfig;
let stop = () => {};
function pointer(target: Element) {
	const e = new MouseEvent("pointerdown", {
		bubbles: true,
		cancelable: true,
		clientX: 10,
		clientY: 20,
	});
	Object.defineProperties(e, {
		pointerId: { value: 2 },
		pointerType: { value: "touch" },
	});
	target.dispatchEvent(e);
	return e;
}
beforeEach(() => {
	vi.clearAllMocks();
	history.replaceState(null, "", "/local/game");
	document.body.innerHTML =
		'<div role="application" aria-label="Game board"><button data-card-id="card-1"><span></span></button></div><div role="dialog"><button id="cover"></button></div>';
	Object.defineProperty(document, "elementFromPoint", {
		configurable: true,
		value: vi.fn(() => document.querySelector("span")),
	});
});
afterEach(() => {
	stop();
	history.replaceState(null, "", "/");
	document.body.innerHTML = "";
});
it("reports hit-test and actual handler delivery after propagation without cancelling input", async () => {
	stop = startInputCapture(config);
	const card = document.querySelector("[data-card-id]")!;
	card.addEventListener("pointerdown", (e) =>
		markCardInput(e, "card-1", "gesture-2"),
	);
	const e = pointer(card.querySelector("span")!);
	expect(e.defaultPrevented).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).toHaveBeenCalledWith(
		"mm.input.capture",
		expect.objectContaining({
			event_type: "pointerdown",
			target_tag: "span",
			target_card_id: "card-1",
			hit_card_id: "card-1",
			target_in_board: true,
			card_handler_ran: true,
			handler_card_id: "card-1",
			gesture_id: "gesture-2",
			pointer_id: 2,
		}),
	);
	const props = vi.mocked(track).mock.calls[0][1];
	expect(props).not.toHaveProperty("clientX");
	expect(props).not.toHaveProperty("clientY");
});
it("observes stopped propagation and an overlay instead of guessing a lost Card callback", async () => {
	stop = startInputCapture(config);
	const cover = document.querySelector("#cover")!;
	vi.mocked(document.elementFromPoint).mockReturnValue(cover);
	cover.addEventListener("pointerdown", (e) => e.stopPropagation());
	pointer(cover);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).toHaveBeenCalledWith(
		"mm.input.capture",
		expect.objectContaining({
			target_card_id: null,
			hit_card_id: null,
			target_in_dialog: true,
			card_handler_ran: false,
			handler_card_id: null,
		}),
	);
});
it("records touchstart delivery separately, including contacts when no pointerdown exists", async () => {
	stop = startInputCapture(config);
	const card = document.querySelector("[data-card-id]")!;
	card.addEventListener("touchstart", (e) => markCardInput(e, "card-1", null));
	const event = new Event("touchstart", { bubbles: true });
	const touch = { identifier: 7, target: card, clientX: 10, clientY: 20 };
	Object.defineProperties(event, {
		changedTouches: { value: [touch] },
		touches: { value: [touch, { identifier: 8 }] },
	});
	card.dispatchEvent(event);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).toHaveBeenCalledWith(
		"mm.input.capture",
		expect.objectContaining({
			event_type: "touchstart",
			touch_identifier: 7,
			pointer_id: null,
			active_touches: 2,
			card_handler_ran: true,
			gesture_id: null,
		}),
	);
});
it("observes cancellation by a later handler and survives unavailable hit testing", async () => {
	stop = startInputCapture(config);
	const card = document.querySelector("[data-card-id]")!;
	card.addEventListener("pointerdown", (e) => e.preventDefault());
	pointer(card);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).toHaveBeenCalledWith(
		"mm.input.capture",
		expect.objectContaining({
			default_prevented_capture: false,
			default_prevented_after: true,
		}),
	);
	vi.mocked(track).mockClear();
	vi.mocked(document.elementFromPoint).mockImplementation(() => {
		throw Error("unavailable");
	});
	expect(() => pointer(card)).not.toThrow();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).not.toHaveBeenCalled();
});
it("honors the kill switch, gameplay route scope and cleanup including pending reports", async () => {
	stop = startInputCapture({ ...config, telemetry: "off" });
	const card = document.querySelector("[data-card-id]")!;
	pointer(card);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).not.toHaveBeenCalled();
	stop();
	stop = startInputCapture(config);
	history.replaceState(null, "", "/local/setup");
	pointer(card);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).not.toHaveBeenCalled();
	history.replaceState(null, "", "/online/game");
	pointer(card);
	stop();
	await new Promise((resolve) => setTimeout(resolve, 0));
	pointer(card);
	expect(track).not.toHaveBeenCalled();
});

it("bounds pending observer reports and reports overflow instead of unbounded input work", async () => {
	stop = startInputCapture(config);
	const card = document.querySelector("[data-card-id]")!;
	for (let i = 0; i < 65; i++) pointer(card);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(track).toHaveBeenCalledTimes(64);
	expect(track).toHaveBeenLastCalledWith(
		"mm.input.capture",
		expect.objectContaining({ capture_dropped_total: 1 }),
	);
});
