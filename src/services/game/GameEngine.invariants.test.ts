import { describe, expect, it } from "vitest";
import {
	initializeCards,
	getPlayersFromPresence,
	applyMatch,
	applyNoMatchWithReset,
	checkMatch,
	flipCard,
	checkAndFinishGame,
	getPlayerScore,
	createInitialState,
	startGameWithCards,
} from "./GameEngine";
const images = Array.from({ length: 8 }, (_, i) => ({
	id: `image-${i}`,
	url: `url-${i}`,
}));
describe("game invariants", () => {
	it("produces a reproducible permutation without changing its input", () => {
		const copy = structuredClone(images);
		const first = initializeCards(images, () => 0.25);
		const second = initializeCards(images, () => 0.25);
		expect(first).toEqual(second);
		expect(images).toEqual(copy);
		expect(new Set(first.map((c) => c.id)).size).toBe(16);
		for (const image of images)
			expect(first.filter((c) => c.imageId === image.id)).toHaveLength(2);
	});
	it("orders players by slot regardless of presence arrival order", () => {
		expect(
			getPlayersFromPresence({
				b: { name: "Guest", color: "blue", slot: 2 },
				a: { name: "Host", color: "red", slot: 1 },
			}).map((p) => p.id),
		).toEqual([1, 2]);
	});
	it("conserves scores through a complete game with alternating misses", () => {
		let state = startGameWithCards(
			createInitialState(),
			initializeCards(images, () => 0.7),
		);
		state = flipCard(flipCard(state, "card-0"), "card-2");
		state = applyNoMatchWithReset(state, ["card-0", "card-2"]);
		expect(state.currentPlayer).toBe(2);
		for (let i = 0; i < 16; i += 2) {
			state = flipCard(flipCard(state, `card-${i}`), `card-${i + 1}`);
			const result = checkMatch(state)!;
			expect(result.isMatch).toBe(true);
			state = checkAndFinishGame(applyMatch(state, result));
			expect(
				getPlayerScore(state.cards, 1) + getPlayerScore(state.cards, 2),
			).toBe((i + 2) / 2);
		}
		expect(state.gameStatus).toBe("finished");
		expect(getPlayerScore(state.cards, 2)).toBe(8);
	});
});
