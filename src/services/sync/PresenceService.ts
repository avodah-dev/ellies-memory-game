import {
	onDisconnect,
	onValue,
	ref,
	serverTimestamp,
	set,
	type Database,
	type DatabaseReference,
} from "firebase/database";
import { rtdb } from "../../lib/firebase";
export interface PresenceDataInternal {
	odahId: string;
	name: string;
	color: string;
	slot: 1 | 2;
	online: boolean;
	lastSeen: object | number;
}
export class PresenceService {
	private roomCode: string;
	private odahId: string;
	private playerName: string;
	private playerColor: string;
	private playerSlot: 1 | 2;
	private database: Database;
	private presenceRef: DatabaseReference | null = null;
	private unsubscribeConnected: (() => void) | null = null;
	private connected = false;
	private active = false;
	private cancelStart: (() => void) | null = null;
	constructor(
		roomCode: string,
		odahId: string,
		name: string,
		color: string,
		slot: 1 | 2,
		database: Database = rtdb,
	) {
		this.roomCode = roomCode;
		this.odahId = odahId;
		this.playerName = name;
		this.playerColor = color;
		this.playerSlot = slot;
		this.database = database;
	}
	private payload(online: boolean): PresenceDataInternal {
		return {
			odahId: this.odahId,
			name: this.playerName,
			color: this.playerColor,
			slot: this.playerSlot,
			online,
			lastSeen: serverTimestamp(),
		};
	}
	async start(): Promise<void> {
		if (this.active) throw new Error("Presence already started");
		this.active = true;
		const reference = ref(
			this.database,
			`presence/${this.roomCode}/${this.odahId}`,
		);
		this.presenceRef = reference;
		return new Promise((resolve, reject) => {
			let settled = false;
			const fail = (error: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.active = false;
				this.unsubscribeConnected?.();
				this.unsubscribeConnected = null;
				this.cancelStart = null;
				reject(error);
			};
			const timeout = setTimeout(
				() => fail(new Error("Presence connection timeout")),
				10000,
			);
			this.cancelStart = () => fail(new Error("Presence start cancelled"));
			this.unsubscribeConnected = onValue(
				ref(this.database, ".info/connected"),
				async (snapshot) => {
					this.connected = snapshot.val() === true;
					if (!this.connected || !this.active) return;
					try {
						await onDisconnect(reference).set(this.payload(false));
						if (!this.active) return;
						await set(reference, this.payload(true));
						if (!settled) {
							settled = true;
							clearTimeout(timeout);
							this.cancelStart = null;
							resolve();
						}
					} catch (error) {
						if (!settled) fail(error as Error);
						else console.error("Presence reconnect failed", error);
					}
				},
				fail,
			);
		});
	}
	async stop(): Promise<void> {
		this.active = false;
		this.cancelStart?.();
		this.cancelStart = null;
		this.unsubscribeConnected?.();
		this.unsubscribeConnected = null;
		const reference = this.presenceRef;
		this.presenceRef = null;
		// When offline, the registered server disconnect hook owns cleanup.
		if (reference && this.connected) {
			await set(reference, this.payload(false));
			await onDisconnect(reference).cancel();
		}
		this.connected = false;
	}
	async updateName(name: string) {
		this.playerName = name;
		if (this.presenceRef && this.connected)
			await set(this.presenceRef, this.payload(true));
	}
	async updateColor(color: string) {
		this.playerColor = color;
		if (this.presenceRef && this.connected)
			await set(this.presenceRef, this.payload(true));
	}
	static subscribeToRoomPresence(
		code: string,
		callback: (players: Record<string, PresenceDataInternal>) => void,
	) {
		return onValue(ref(rtdb, `presence/${code}`), (snapshot) =>
			callback(snapshot.val() ?? {}),
		);
	}
	static subscribeToPlayerPresence(
		code: string,
		uid: string,
		callback: (presence: PresenceDataInternal | null) => void,
	) {
		return onValue(ref(rtdb, `presence/${code}/${uid}`), (snapshot) =>
			callback(snapshot.val()),
		);
	}
}
