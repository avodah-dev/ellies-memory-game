import { expect, it } from "vitest";
import { createCardInput } from "./cardInput";
const pointer = (pointerId = 1, pointerType = "touch", x = 10) => ({
	pointerId,
	pointerType,
	button: 0,
	clientX: x,
	clientY: 20,
});
function click(props: Record<string, unknown> = {}) {
	return {
		detail: 1,
		nativeEvent: {
			clientX: 10,
			clientY: 20,
			...props,
		} as unknown as MouseEvent,
	};
}
it("handles every touch independently, correlates out-of-order releases, consumes only the clicked contact", () => {
	const input = createCardInput();
	const a = input.down(pointer(1)),
		b = input.down(pointer(2, "touch", 40));
	expect(a.handled && b.handled).toBe(true);
	input.end(pointer(2, "touch", 40), false);
	input.end(pointer(1), false);
	expect(
		input.click(click({ pointerId: 2, pointerType: "touch", clientX: 40 })),
	).toMatchObject({
		activate: false,
		gesture: { id: b.id },
		association: "pointer-id",
	});
	expect(
		input.click(click({ pointerId: 1, pointerType: "touch" })),
	).toMatchObject({ activate: false, gesture: { id: a.id } });
});
it("associates a WebKit MouseEvent or unmatched numeric ID only with an unambiguous released contact", () => {
	const input = createCardInput();
	const g = input.down(pointer());
	input.end(pointer(), false);
	expect(input.click(click({ pointerId: 0 }))).toMatchObject({
		activate: false,
		gesture: { id: g.id },
		association: "released-contact",
	});
	const second = input.down(pointer(2));
	input.end(pointer(2), false);
	expect(input.click(click())).toMatchObject({
		activate: false,
		gesture: { id: second.id },
	});
});
it("does not manufacture links for ambiguous, cancelled, expired or wrong-type gestures", () => {
	let now = 0;
	const input = createCardInput(() => now);
	input.down(pointer(1));
	input.end(pointer(1), false);
	input.down(pointer(2));
	input.end(pointer(2), false);
	expect(input.click(click())).toMatchObject({
		activate: false,
		association: "ambiguous",
		gesture: null,
	});
	now = 1501;
	expect(input.click(click())).toMatchObject({
		activate: false,
		association: "none",
		gesture: null,
	});
	input.down(pointer(3));
	input.end(pointer(3), true);
	expect(input.click(click())).toMatchObject({
		activate: false,
		gesture: null,
	});
	expect(
		input.click(click({ pointerId: 3, pointerType: "mouse" })),
	).toMatchObject({ activate: false, gesture: { cancelled: true } });
});
it("keeps mouse, keyboard and assistive clicks immediately after touch; no suppression timeout", () => {
	const input = createCardInput();
	input.down(pointer());
	input.end(pointer(), false);
	expect(input.click({ ...click(), detail: 0 })).toMatchObject({
		activate: true,
		type: "keyboard",
		gesture: null,
	});
	input.down(pointer(4, "mouse"));
	input.end(pointer(4, "mouse"), false);
	expect(input.click(click())).toMatchObject({ activate: true, type: "mouse" });
	expect(createCardInput().click(click())).toMatchObject({
		activate: true,
		type: "unknown",
	});
});
it("accepts pen tip only, suppresses direct clicks even with no surviving contact metadata", () => {
	const input = createCardInput();
	expect(input.down(pointer(1, "pen")).handled).toBe(true);
	expect(input.down({ ...pointer(2, "pen"), button: 2 }).handled).toBe(false);
	expect(
		input.click(click({ pointerType: "pen", pointerId: 99 })).activate,
	).toBe(false);
	expect(
		input.click(click({ sourceCapabilities: { firesTouchEvents: true } }))
			.activate,
	).toBe(false);
	expect(input.end(pointer(99), false)).toBeNull();
	for (let i = 10; i < 30; i++) input.down(pointer(i));
	expect(
		input.click(click({ pointerId: 10, pointerType: "touch" })).gesture,
	).toBeNull();
});

it("suppresses WebKit's native mouse-labelled click after touch, without suppressing a real mouse", () => {
	const input = createCardInput();
	const g = input.down(pointer(0));
	input.end(pointer(0), false);
	expect(
		input.click(click({ pointerId: 1, pointerType: "mouse" })),
	).toMatchObject({
		activate: false,
		type: "touch",
		gesture: { id: g.id },
		association: "released-contact",
	});
	input.down(pointer(1, "mouse"));
	input.end(pointer(1, "mouse"), false);
	expect(
		input.click(click({ pointerId: 1, pointerType: "mouse" })),
	).toMatchObject({ activate: true, type: "mouse", association: "pointer-id" });
});
