import { describe, it, expect } from "vitest";
import {
	assertNextRevision,
	isGameState,
	isNewerState,
	parseOnlineState,
	parseStoredOnlineState,
	parseRoom,
	serializeGame,
	SyncError,
} from "./stateProtocol";
import {
	createTestOnlineGameState,
	createTestRoom,
	createTestCard,
} from "../../test/testUtils";
const state = () =>
	createTestOnlineGameState({
		cards: [createTestCard()],
		gameRound: 2,
		syncVersion: 3,
	});
describe("state protocol", () => {
	it("compares rounds before versions, including self echoes", () => {
		expect(
			isNewerState({ ...state(), gameRound: 1, syncVersion: 99 }, state()),
		).toBe(false);
		expect(
			isNewerState({ ...state(), gameRound: 3, syncVersion: 1 }, state()),
		).toBe(true);
		expect(isNewerState({ ...state(), syncVersion: 4 }, state())).toBe(true);
		expect(isNewerState(state(), state())).toBe(false);
	});
	it("requires exactly the next revision in the same round", () => {
		expect(() =>
			assertNextRevision(state(), { ...state(), syncVersion: 4 }),
		).not.toThrow();
		for (const changes of [
			{ syncVersion: 3 },
			{ syncVersion: 5 },
			{ gameRound: 1, syncVersion: 4 },
		])
			expect(() =>
				assertNextRevision(state(), { ...state(), ...changes }),
			).toThrow(SyncError);
	});
	it.each([
		null,
		[],
		{},
		{ cards: [], currentPlayer: 3, gameStatus: "playing" },
		{ cards: [], currentPlayer: 1, gameStatus: "bad" },
	])("rejects malformed state %j", (v) => expect(isGameState(v)).toBe(false));
	it("validates every card and ownership", () => {
		for (const change of [
			{ id: 4 },
			{ imageId: 4 },
			{ imageUrl: 4 },
			{ isFlipped: 1 },
			{ isMatched: 1 },
			{ gradient: 4 },
			{ matchedByPlayerId: 3 },
			{ isMatched: true },
			{ isMatched: true, matchedByPlayerId: 1 },
		])
			expect(
				isGameState({
					...state(),
					cards: [{ ...createTestCard(), ...change }],
				}),
			).toBe(false);
		expect(
			isGameState({ ...state(), cards: [createTestCard(), createTestCard()] }),
		).toBe(false);
		expect(isGameState({ ...state(), gameStatus: "finished" })).toBe(false);
		expect(isGameState({ ...state(), gameStatus: "finished", cards: [] })).toBe(
			false,
		);
		expect(
			isGameState({
				...state(),
				gameStatus: "finished",
				cards: [
					createTestCard({
						isFlipped: true,
						isMatched: true,
						matchedByPlayerId: 1,
						gradient: "red",
					}),
				],
			}),
		).toBe(true);
	});
	it("validates revision metadata", () => {
		expect(parseOnlineState(state())).toEqual(state());
		expect(parseOnlineState({ ...state(), lastUpdatedBy: 2 })).toMatchObject({
			lastUpdatedBy: 2,
		});
		for (const change of [
			{ cards: null },
			{ gameRound: 0 },
			{ gameRound: 1.5 },
			{ syncVersion: 0 },
			{ syncVersion: 1.2 },
			{ lastUpdatedBy: 3 },
		])
			expect(() => parseOnlineState({ ...state(), ...change })).toThrow();
	});
	it("omits undefined fields while preserving defined card values", () => {
		expect(Object.keys(serializeGame(state()).cards[0])).not.toContain(
			"gradient",
		);
		const card = createTestCard({
			gradient: "red",
			isMatched: true,
			isFlipped: true,
			matchedByPlayerId: 1,
		});
		expect(
			parseStoredOnlineState(serializeGame({ ...state(), cards: [card] }))
				.cards[0],
		).toEqual(card);
		expect(serializeGame({ ...state(), cards: [card] }).matches).toEqual({
			"0": 1,
		});
	});
	it("round trips the immutable deck, selection and awarded matches", () => {
		const game = {
			...state(),
			lastUpdatedBy: 2,
			cards: [
				createTestCard({ id: "one" }),
				createTestCard({ id: "two", isFlipped: true }),
				createTestCard({
					id: "three",
					isFlipped: true,
					isMatched: true,
					matchedByPlayerId: 2,
				}),
			],
		};
		expect(parseStoredOnlineState(serializeGame(game))).toEqual(game);
		const stored = serializeGame(game);
		for (const invalid of [
			null,
			{},
			{ ...stored, cards: null },
			{ ...stored, selectedIndexes: null },
			{ ...stored, matches: null },
			{ ...stored, matches: [] },
			{ ...stored, selectedIndexes: [0, 1, 2] },
			{ ...stored, selectedIndexes: [1, 1] },
			{ ...stored, selectedIndexes: [2] },
			{ ...stored, selectedIndexes: [-1] },
			{ ...stored, selectedIndexes: [0.5] },
			{ ...stored, selectedIndexes: [3] },
			{ ...stored, selectedIndexes: ["1"] },
			{ ...stored, matches: { "3": 1 } },
			{ ...stored, matches: { "01": 1 } },
			{ ...stored, matches: { "0": 3 } },
			{ ...stored, matches: { "0": "1" } },
			{ ...stored, cards: [null] },
			{ ...stored, cards: [{ ...stored.cards[0], isMatched: true }] },
		])
			expect(() => parseStoredOnlineState(invalid)).toThrow(SyncError);
	});
	it("validates room configuration and membership", () => {
		const room = createTestRoom({
			playerSlots: { host: 1 },
			hostId: "host",
			config: {
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 4,
			},
		});
		expect(parseRoom(room)).toEqual(room);
		for (const change of [
			null,
			{},
			{ ...room, config: null },
			{ ...room, playerSlots: {} },
			{ ...room, playerSlots: { host: 1, a: 2, b: 2 } },
			{ ...room, playerSlots: { host: 2 } },
			{ ...room, playerSlots: { host: 1, a: null } },
			{ ...room, playerSlots: { host: 1, a: 1 } },
		])
			expect(() => parseRoom(change)).toThrow();
		for (const config of [
			{ cardPack: 1 },
			{ background: 1 },
			{ cardBack: 1 },
			{ pairCount: 3 },
			{ pairCount: 21 },
			{ pairCount: 4.5 },
		])
			expect(() =>
				parseRoom({ ...room, config: { ...room.config, ...config } }),
			).toThrow();
	});
});
