import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useLocalGame } from "../hooks/useLocalGame";
import { useSettingsStore, useUIStore } from "../stores";
import { getPlayerScore } from "../services/game/GameEngine";
import { createTestSettings } from "../test/testUtils";
import { GameBoard } from "./GameBoard";

function Gameplay() {
	const game = useLocalGame();
	return (
		<>
			<label>
				Player one
				<input
					value={game.players[0].name}
					onChange={(event) => game.updatePlayerName(1, event.target.value)}
				/>
			</label>
			<button
				onClick={() =>
					game.initializeGame(
						[
							{ id: "cat", url: "🐈" },
							{ id: "dog", url: "🐕" },
						],
						true,
					)
				}
			>
				Deal
			</button>
			<output aria-label="Turn">{game.gameState.currentPlayer}</output>
			<output aria-label="Score">
				{getPlayerScore(game.gameState.cards, 1)}
			</output>
			<output aria-label="Status">{game.gameState.gameStatus}</output>
			<GameBoard cards={game.gameState.cards} onCardClick={game.flipCard} />
		</>
	);
}
beforeEach(() => {
	useSettingsStore.setState({
		settings: createTestSettings({ flipDuration: 1, ttsEnabled: false }),
	});
	useUIStore.getState().resetUIState();
});
afterEach(() => useSettingsStore.persist.clearStorage());
it("uses real cards, controller and stores for keyboard play, scoring and persisted names", async () => {
	const user = userEvent.setup();
	const rendered = render(<Gameplay />);
	const input = screen.getByRole("textbox", { name: "Player one" });
	await user.clear(input);
	await user.type(input, "Ellie");
	await user.click(screen.getByRole("button", { name: "Deal" }));
	const zero = screen.getByRole("button", { name: "Face-down card card-0" });
	zero.focus();
	await user.keyboard("{Enter}");
	expect(zero).toHaveAttribute("aria-pressed", "true");
	await user.click(
		screen.getByRole("button", { name: "Face-down card card-1" }),
	);
	await waitFor(() =>
		expect(screen.getByLabelText("Score")).toHaveTextContent("1"),
	);
	expect(screen.getByLabelText("Turn")).toHaveTextContent("1");
	await user.click(
		screen.getByRole("button", { name: "Face-down card card-2" }),
	);
	await user.click(
		screen.getByRole("button", { name: "Face-down card card-3" }),
	);
	await waitFor(() =>
		expect(screen.getByLabelText("Status")).toHaveTextContent("finished"),
	);
	expect(screen.getByLabelText("Score")).toHaveTextContent("2");
	rendered.unmount();
	// Rehydrate the actual persistence middleware, then mount a fresh game.
	await act(async () => {
		await useSettingsStore.persist.rehydrate();
	});
	render(<Gameplay />);
	expect(screen.getByRole("textbox", { name: "Player one" })).toHaveValue(
		"Ellie",
	);
	expect(screen.getByLabelText("Status")).toHaveTextContent("setup");
});
