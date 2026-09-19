import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteApp } from "firebase/app";
import {
	doc,
	getDocFromServer,
	onSnapshot,
	setDoc,
	terminate,
	updateDoc,
} from "firebase/firestore";
import { get, goOffline, goOnline, ref, set } from "firebase/database";
import {
	createFirebaseServices,
	type FirebaseServices,
} from "../../src/lib/firebaseClient";
import { FirestoreSyncAdapter } from "../../src/services/sync/FirestoreSyncAdapter";
import {
	createInitialState,
	initializeCards,
	startGameWithCards,
	flipCard,
	applyMatch,
	checkMatch,
	checkAndFinishGame,
	endTurn,
} from "../../src/services/game/GameEngine";
import { serializeGame } from "../../src/services/sync/stateProtocol";
import type { GameState, OnlineGameState } from "../../src/types";
import ports from "../../local-ports.json";

const clients: FirebaseServices[] = [];
const adapters: FirestoreSyncAdapter[] = [];
async function client() {
	const c = createFirebaseServices("emulator", crypto.randomUUID());
	clients.push(c);
	const a = new FirestoreSyncAdapter(c);
	adapters.push(a);
	await a.connect();
	return { c, a, uid: a.getOdahId()! };
}
const options = {
	hostId: "ignored",
	hostName: "Host",
	hostColor: "#123456",
	cardPack: "animals" as const,
	background: "default",
	cardBack: "default",
	pairCount: 4,
};
const initial = (pairCount = 4) =>
	startGameWithCards(
		createInitialState(),
		initializeCards(
			Array.from({ length: pairCount }, (_, i) => ({
				id: `image-${i}`,
				url: `emoji-${i}`,
			})),
			() => 0.5,
		),
	);
async function room() {
	const host = await client(),
		guest = await client();
	const code = await host.a.createRoom(options);
	await guest.a.joinRoom(code, {
		odahId: guest.uid,
		name: "Guest",
		color: "#654321",
	});
	return { host, guest, code };
}
async function move(
	adapter: FirestoreSyncAdapter,
	current: OnlineGameState,
	next: GameState,
) {
	await adapter.setState({
		...current,
		...next,
		syncVersion: current.syncVersion + 1,
		lastUpdatedBy: current.currentPlayer,
	} as OnlineGameState);
	return (await adapter.getState()) as OnlineGameState;
}
async function eventually(check: () => Promise<boolean>, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("Condition was not observed");
}
beforeEach(async () => {
	const r = await fetch(
		`http://127.0.0.1:${ports.firestore}/emulator/v1/projects/demo-matchimus/databases/main-firestore/documents`,
		{ method: "DELETE" },
	);
	if (!r.ok) throw new Error("Named Firestore emulator unavailable");
	await fetch(
		`http://127.0.0.1:${ports.database}/.json?ns=demo-matchimus-default-rtdb&auth=owner`,
		{ method: "DELETE" },
	);
});
afterEach(async () => {
	for (const c of clients) goOnline(c.rtdb);
	await Promise.all(adapters.splice(0).map((a) => a.disconnect()));
	await Promise.all(
		clients.splice(0).map(async (c) => {
			goOffline(c.rtdb);
			await terminate(c.db);
			await deleteApp(c.app);
		}),
	);
});
describe("real Firebase adapters and checked-in rules", () => {
	it("returns the committed start state while an empty-game listener is already active", async () => {
		const { host, guest, code } = await room();
		let stop = () => {};
		await new Promise<void>((resolve, reject) => {
			stop = onSnapshot(
				doc(host.c.db, "games", code),
				{ includeMetadataChanges: true },
				(snapshot) => {
					if (!snapshot.metadata.fromCache && !snapshot.exists()) resolve();
				},
				reject,
			);
		});
		try {
			const started = await host.a.startGame(code, initial());
			expect(started).toMatchObject({
				gameRound: 1,
				syncVersion: 1,
				gameStatus: "playing",
			});
			expect(started).toEqual(await guest.a.getState());
		} finally {
			stop();
		}
	});
	it("admits only one of two simultaneous guests", async () => {
		const host = await client(),
			one = await client(),
			two = await client();
		const code = await host.a.createRoom(options);
		const results = await Promise.allSettled(
			[one, two].map((g) =>
				g.a.joinRoom(code, { odahId: g.uid, name: "Guest", color: "red" }),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(Object.keys((await host.a.getRoom(code))!.playerSlots)).toHaveLength(
			2,
		);
	});
	it("deletes a departed guest slot so another guest can join", async () => {
		const { host, guest, code } = await room();
		await guest.a.leaveRoom();
		const replacement = await client();
		await replacement.a.joinRoom(code, {
			odahId: replacement.uid,
			name: "New guest",
			color: "blue",
		});
		expect((await host.a.getRoom(code))!.playerSlots).toEqual({
			[host.uid]: 1,
			[replacement.uid]: 2,
		});
	});
	it("atomically starts a game and rejects stale/unauthorized writes", async () => {
		const { host, guest, code } = await room();
		await host.a.startGame(code, initial());
		const state = (await host.a.getState()) as OnlineGameState;
		expect(state.gameRound).toBe(1);
		expect((await guest.a.getRoom(code))!.status).toBe("playing");
		const next = {
			...flipCard(state, state.cards[0].id),
			gameRound: state.gameRound,
			syncVersion: 2,
			lastUpdatedBy: 1,
		};
		await expect(guest.a.setState(next)).rejects.toThrow("not your turn");
		await host.a.setState(next);
		await expect(host.a.setState(next)).rejects.toThrow("Game changed");
		const outsider = await client();
		await expect(
			getDocFromServer(doc(outsider.c.db, "games", code)),
		).rejects.toMatchObject({ code: "permission-denied" });
		await expect(
			setDoc(
				doc(guest.c.db, "games", code),
				serializeGame({ ...next, syncVersion: 3 }),
			),
		).rejects.toMatchObject({ code: "permission-denied" });
		await expect(
			updateDoc(doc(guest.c.db, "rooms", code), { "config.pairCount": 12 }),
		).rejects.toMatchObject({ code: "permission-denied" });
	});
	it("increments replay rounds and delivers confirmed state through the real listener", async () => {
		const { host, guest, code } = await room();
		await host.a.startGame(code, initial());
		const received: OnlineGameState[] = [];
		const stop = guest.a.subscribeToState((s) =>
			received.push(s as OnlineGameState),
		);
		await host.a.resetRoomToWaiting(code);
		const replay = await host.a.startGame(code, initial());
		expect(replay).toMatchObject({ gameRound: 2, syncVersion: 1 });
		await eventually(async () =>
			received.some((s) => s.gameRound === 2 && s.syncVersion === 1),
		);
		stop();
	});
	it("rejects forged outcomes and deck edits even from the current player", async () => {
		const { host, guest, code } = await room();
		await host.a.startGame(code, initial());
		const state = (await host.a.getState()) as OnlineGameState;
		const write = (next: OnlineGameState) =>
			setDoc(doc(host.c.db, "games", code), serializeGame(next));
		const next = { ...state, syncVersion: 2, lastUpdatedBy: 1 };
		for (const forged of [
			{ ...next, gameStatus: "finished" as const },
			{
				...next,
				cards: next.cards.map((c) => ({
					...c,
					isMatched: true,
					isFlipped: true,
					matchedByPlayerId: 1,
				})),
				gameStatus: "finished" as const,
			},
			{
				...next,
				cards: next.cards.map((c, i) =>
					i === 0 ? { ...c, imageId: "forged", isFlipped: true } : c,
				),
			},
			{
				...next,
				cards: next.cards.map((c, i) =>
					i < 2
						? { ...c, isMatched: true, isFlipped: true, matchedByPlayerId: 1 }
						: c,
				),
			},
		])
			await expect(write(forged)).rejects.toMatchObject({
				code: "permission-denied",
			});
		const flipped = await move(
			host.a,
			state,
			flipCard(state, state.cards[0].id),
		);
		// Resetting a selection must give the other player the turn.
		await expect(
			write({ ...flipped, cards: state.cards, syncVersion: 3 }),
		).rejects.toMatchObject({ code: "permission-denied" });
		let otherTurn = await move(host.a, flipped, endTurn(flipped));
		expect(otherTurn.currentPlayer).toBe(2);
		const different = state.cards.find(
			(c) => c.imageId !== state.cards[0].imageId,
		)!;
		for (const id of [state.cards[0].id, different.id])
			otherTurn = await move(guest.a, otherTurn, flipCard(otherTurn, id));
		const awardedMismatch = serializeGame({
			...otherTurn,
			syncVersion: otherTurn.syncVersion + 1,
			lastUpdatedBy: 2,
			cards: otherTurn.cards.map((c) =>
				c.isFlipped ? { ...c, isMatched: true, matchedByPlayerId: 2 } : c,
			),
		});
		await expect(
			setDoc(doc(guest.c.db, "games", code), awardedMismatch),
		).rejects.toMatchObject({ code: "permission-denied" });
		const third = otherTurn.cards.find((c) => !c.isFlipped)!;
		await expect(
			setDoc(
				doc(guest.c.db, "games", code),
				serializeGame({
					...otherTurn,
					syncVersion: otherTurn.syncVersion + 1,
					lastUpdatedBy: 2,
					cards: otherTurn.cards.map((c) =>
						c.id === third.id ? { ...c, isFlipped: true } : c,
					),
				}),
			),
		).rejects.toMatchObject({ code: "permission-denied" });
	});
	it("validates the largest board and permits only genuine matches through completion", async () => {
		const { host, code } = await room();
		await host.a.updateRoomConfig(code, { pairCount: 20 });
		const deck = initial(20);
		await expect(
			host.a.startGame(code, {
				...deck,
				cards: deck.cards.map((c) => ({ ...c, isFlipped: true })),
			}),
		).rejects.toMatchObject({ code: "permission-denied" });
		await host.a.startGame(code, deck);
		let state = (await host.a.getState()) as OnlineGameState;
		for (let i = 0; i < 40; i += 2) {
			for (const id of [`card-${i}`, `card-${i + 1}`]) {
				state = await move(host.a, state, flipCard(state, id));
			}
			state = await move(
				host.a,
				state,
				checkAndFinishGame(applyMatch(state, checkMatch(state)!)),
			);
			if (i === 0)
				await expect(
					setDoc(
						doc(host.c.db, "games", code),
						serializeGame({
							...state,
							syncVersion: state.syncVersion + 1,
							cards: state.cards.map((c) =>
								c.isMatched ? { ...c, matchedByPlayerId: 2 } : c,
							),
						}),
					),
				).rejects.toMatchObject({ code: "permission-denied" });
		}
		expect(state.gameStatus).toBe("finished");
		await expect(host.a.startGame(code, state)).rejects.toMatchObject({
			code: "permission-denied",
		});
		await expect(
			setDoc(
				doc(host.c.db, "games", code),
				serializeGame({
					...state,
					gameStatus: "playing",
					syncVersion: state.syncVersion + 1,
				} as OnlineGameState),
			),
		).rejects.toMatchObject({ code: "permission-denied" });
	});
	it("runs onDisconnect over a real RTDB connection and recovers presence", async () => {
		const { host, guest, code } = await room();
		const presence = ref(host.c.rtdb, `presence/${code}/${guest.uid}`);
		expect((await get(presence)).val().online).toBe(true);
		goOffline(guest.c.rtdb);
		await eventually(async () => (await get(presence)).val()?.online === false);
		goOnline(guest.c.rtdb);
		await eventually(async () => (await get(presence)).val()?.online === true);
	});
	it("denies forged and malformed presence and cursor payloads", async () => {
		const { host, guest, code } = await room();
		await expect(
			set(ref(guest.c.rtdb, `presence/${code}/${host.uid}`), { online: false }),
		).rejects.toThrow();
		await expect(
			set(ref(guest.c.rtdb, `presence/${code}/${guest.uid}`), {
				odahId: guest.uid,
				slot: 3,
				name: "Guest",
				color: "red",
				online: true,
				lastSeen: Date.now(),
			}),
		).rejects.toThrow();
		await expect(
			set(ref(guest.c.rtdb, `cursors/${code}/${guest.uid}`), {
				x: "bad",
				y: 2,
				timestamp: Date.now(),
			}),
		).rejects.toThrow();
	});
});
