import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Card } from "./Card";
import { track } from "../services/telemetry/core";
vi.mock("../services/telemetry/core", () => ({
	counters: { cardRenders: 0 },
	track: vi.fn(),
	beginInput: vi.fn(() => "input-1"),
	currentInputId: () => null,
	getContext: () => ({}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
const data = {
	id: "one",
	imageId: "one",
	imageUrl: "x",
	isFlipped: false,
	isMatched: false,
};
function pointer(
	target: HTMLElement,
	phase: string,
	id: number,
	type = "touch",
	button = 0,
) {
	const e = new MouseEvent(`pointer${phase}`, {
		bubbles: true,
		button,
		clientX: 10,
		clientY: 20,
	});
	Object.defineProperties(e, {
		pointerId: { value: id },
		pointerType: { value: type },
		isPrimary: { value: id === 1 },
	});
	fireEvent(target, e);
}
it("activates two fingers on down, retains per-contact telemetry and suppresses later WebKit clicks", () => {
	const action = vi.fn();
	render(
		<>
			<Card card={data} onClick={action} />
			<Card card={{ ...data, id: "two" }} onClick={action} />
		</>,
	);
	const [a, b] = screen.getAllByRole("button");
	pointer(a, "down", 1);
	pointer(b, "down", 2);
	expect(action).toHaveBeenCalledTimes(2); // before either up or click
	pointer(b, "up", 2);
	pointer(a, "up", 1);
	fireEvent.click(a, { detail: 1, clientX: 10, clientY: 20 });
	fireEvent.click(b, { detail: 1, clientX: 10, clientY: 20 });
	expect(action).toHaveBeenCalledTimes(2);
	const events = vi.mocked(track).mock.calls;
	expect(events.filter(([n]) => n === "mm.input.activation")).toHaveLength(2);
	expect(
		events.filter(([n]) => n === "mm.input.click").map(([, p]) => p),
	).toEqual([
		expect.objectContaining({
			activation_suppressed: true,
			association: "released-contact",
			input_id: "input-1",
		}),
		expect.objectContaining({
			activation_suppressed: true,
			association: "released-contact",
			input_id: "input-1",
		}),
	]);
});
it("keeps mouse activation on click and keyboard activation after touch", () => {
	const action = vi.fn();
	render(<Card card={data} onClick={action} />);
	const target = screen.getByRole("button");
	pointer(target, "down", 1);
	pointer(target, "cancel", 1);
	expect(action).toHaveBeenCalledTimes(1); // Nathan accepts no undo on pan/cancel
	pointer(target, "down", 3, "mouse");
	pointer(target, "up", 3, "mouse");
	expect(action).toHaveBeenCalledTimes(1);
	fireEvent.click(target, { detail: 1 });
	fireEvent.click(target, { detail: 0 });
	expect(action).toHaveBeenCalledTimes(3);
});
it("accepts pen tip, ignores pen secondary button and matched cards", () => {
	const action = vi.fn();
	const { rerender } = render(<Card card={data} onClick={action} />);
	pointer(screen.getByRole("button"), "down", 1, "pen");
	pointer(screen.getByRole("button"), "down", 2, "pen", 2);
	expect(action).toHaveBeenCalledTimes(1);
	rerender(<Card card={{ ...data, isMatched: true }} onClick={action} />);
	pointer(screen.getByRole("button"), "down", 3);
	fireEvent.click(screen.getByRole("button"));
	expect(action).toHaveBeenCalledTimes(1);
});
