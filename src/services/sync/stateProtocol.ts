import type { Card, GameState, OnlineGameState, Room } from "../../types";
export class SyncError extends Error {
	readonly code: "conflict" | "invalid-state" | "disconnected";
	constructor(code: SyncError["code"], message: string) {
		super(message);
		this.name = "SyncError";
		this.code = code;
	}
}
const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object";
export function isGameState(value: unknown): value is GameState {
	if (
		!object(value) ||
		!Array.isArray(value.cards) ||
		![1, 2].includes(value.currentPlayer as number) ||
		!["setup", "playing", "finished"].includes(value.gameStatus as string)
	)
		return false;
	const ids = new Set<string>();
	for (const card of value.cards) {
		if (
			!object(card) ||
			typeof card.id !== "string" ||
			ids.has(card.id) ||
			typeof card.imageId !== "string" ||
			typeof card.imageUrl !== "string" ||
			typeof card.isFlipped !== "boolean" ||
			typeof card.isMatched !== "boolean"
		)
			return false;
		if (card.gradient !== undefined && typeof card.gradient !== "string")
			return false;
		if (
			card.matchedByPlayerId !== undefined &&
			![1, 2].includes(card.matchedByPlayerId as number)
		)
			return false;
		if (
			card.isMatched !== (card.matchedByPlayerId !== undefined) ||
			(card.isMatched && !card.isFlipped)
		)
			return false;
		ids.add(card.id);
	}
	return (
		value.gameStatus !== "finished" ||
		(value.cards.length > 0 && value.cards.every((c: Card) => c.isMatched))
	);
}
export function parseOnlineState(value: unknown): OnlineGameState {
	if (!isGameState(value))
		throw new SyncError("invalid-state", "Invalid game state");
	const v = value as OnlineGameState;
	if (
		!Number.isInteger(v.gameRound) ||
		v.gameRound < 1 ||
		!Number.isInteger(v.syncVersion) ||
		v.syncVersion < 1 ||
		(v.lastUpdatedBy !== undefined &&
			v.lastUpdatedBy !== 1 &&
			v.lastUpdatedBy !== 2)
	)
		throw new SyncError("invalid-state", "Invalid game revision");
	return v;
}
export function isNewerState(
	incoming: OnlineGameState,
	current: { gameRound: number; syncVersion: number },
): boolean {
	return (
		incoming.gameRound > current.gameRound ||
		(incoming.gameRound === current.gameRound &&
			incoming.syncVersion > current.syncVersion)
	);
}
export function assertNextRevision(
	current: OnlineGameState,
	next: OnlineGameState,
): void {
	if (
		next.gameRound !== current.gameRound ||
		next.syncVersion !== current.syncVersion + 1
	)
		throw new SyncError(
			"conflict",
			"Game changed. Resynchronize before moving.",
		);
}
export function serializeGame(state: GameState): GameState {
	return {
		...state,
		cards: state.cards.map(
			({
				id,
				imageId,
				imageUrl,
				isFlipped,
				isMatched,
				gradient,
				matchedByPlayerId,
			}) => ({
				id,
				imageId,
				imageUrl,
				isFlipped,
				isMatched,
				...(gradient === undefined ? {} : { gradient }),
				...(matchedByPlayerId === undefined ? {} : { matchedByPlayerId }),
			}),
		),
	};
}
export function parseRoom(value: unknown): Room {
	if (
		!object(value) ||
		typeof value.roomCode !== "string" ||
		typeof value.hostId !== "string" ||
		!["waiting", "playing", "finished"].includes(value.status as string) ||
		!object(value.playerSlots) ||
		!object(value.config)
	)
		throw new SyncError("invalid-state", "Invalid room");
	const slots = Object.values(value.playerSlots);
	if (
		slots.length < 1 ||
		slots.length > 2 ||
		slots.some((s) => s !== 1 && s !== 2) ||
		new Set(slots).size !== slots.length ||
		value.playerSlots[value.hostId] !== 1
	)
		throw new SyncError("invalid-state", "Invalid room membership");
	const config = value.config;
	if (
		typeof config.cardPack !== "string" ||
		typeof config.background !== "string" ||
		typeof config.cardBack !== "string" ||
		!Number.isInteger(config.pairCount) ||
		Number(config.pairCount) < 4 ||
		Number(config.pairCount) > 20
	)
		throw new SyncError("invalid-state", "Invalid room configuration");
	return value as unknown as Room;
}
