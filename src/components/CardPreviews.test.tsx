import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CardExplorerModal } from "./CardExplorerModal";
import { PlayerMatchesModal } from "./PlayerMatchesModal";
import { track } from "../services/telemetry/core";

vi.mock("../hooks/useTextToSpeech", () => ({
	useTextToSpeech: () => ({ speak: vi.fn(), isAvailable: () => false }),
}));
vi.mock("../services/telemetry/core", () => ({ track: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const cards = [
	{
		id: "card-0",
		imageId: "happy-dog",
		imageUrl: "/test-dog.png",
		isFlipped: true,
		isMatched: true,
		matchedByPlayerId: 1,
	},
	{
		id: "card-1",
		imageId: "happy-dog",
		imageUrl: "/test-dog.png",
		isFlipped: true,
		isMatched: true,
		matchedByPlayerId: 1,
	},
	{
		id: "card-2",
		imageId: "happy-cat",
		imageUrl: "🐱",
		isFlipped: false,
		isMatched: false,
	},
];

it("opens one preview per matched pair through its single button without gameplay activation", async () => {
	const user = userEvent.setup();
	render(
		<PlayerMatchesModal
			isOpen
			onClose={vi.fn()}
			player={{ id: 1, name: "One", color: "#123456" }}
			cards={cards}
		/>,
	);
	const preview = screen.getByRole("button", { name: "View happy dog" });
	expect(screen.getByText("1 pair matched")).toBeVisible();
	expect(preview.querySelector("button, [tabindex]")).toBeNull();
	await user.click(preview.querySelector("img")!);
	expect(screen.getByRole("region", { name: "Card display" })).toBeVisible();
	expect(screen.getByRole("heading", { name: "Happy Dog" })).toBeVisible();
	expect(track).not.toHaveBeenCalled();
});

it("previews matched and unmatched explorer cards with Enter and Space", async () => {
	const user = userEvent.setup();
	render(<CardExplorerModal isOpen onClose={vi.fn()} cards={cards} />);
	for (const [name, key, title] of [
		["View happy dog", "{Enter}", "Happy Dog"],
		["View happy cat", " ", "Happy Cat"],
	]) {
		const preview = screen.getByRole("button", { name });
		expect(within(preview).queryByRole("button")).toBeNull();
		preview.focus();
		await user.keyboard(key);
		expect(screen.getByRole("heading", { name: title })).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Close lightbox" }));
	}
	expect(track).not.toHaveBeenCalled();
});
