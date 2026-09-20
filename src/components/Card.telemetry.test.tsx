import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Card } from "./Card";
import { trackCardClick, trackPointer } from "../services/telemetry/gameplay";
vi.mock("../services/telemetry/gameplay", () => ({
	trackCardClick: vi.fn(),
	trackPointer: vi.fn(),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("records pointer events without activating the card until the existing click", () => {
	const action = vi.fn();
	render(
		<Card
			card={{
				id: "one",
				imageId: "one",
				imageUrl: "x",
				isFlipped: false,
				isMatched: false,
			}}
			onClick={action}
		/>,
	);
	const card = screen.getByRole("button");
	fireEvent.pointerDown(card);
	fireEvent.pointerCancel(card);
	fireEvent.pointerUp(card);
	expect(action).not.toHaveBeenCalled();
	expect(trackPointer).toHaveBeenCalledTimes(3);
	fireEvent.click(card);
	expect(action).toHaveBeenCalledTimes(1);
	expect(trackCardClick).toHaveBeenCalledTimes(1);
});
