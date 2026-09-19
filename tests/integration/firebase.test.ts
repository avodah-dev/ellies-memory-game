import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteApp } from "firebase/app";
import {
	doc,
	getDocFromServer,
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
} from "../../src/services/game/GameEngine";
import type { OnlineGameState } from "../../src/types";
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
const initial = () =>
	startGameWithCards(
		createInitialState(),
		initializeCards(
			Array.from({ length: 4 }, (_, i) => ({
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
			setDoc(doc(guest.c.db, "games", code), { ...next, syncVersion: 3 }),
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
		await host.a.startGame(code, initial());
		await eventually(async () =>
			received.some((s) => s.gameRound === 2 && s.syncVersion === 1),
		);
		stop();
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
