import { deleteApp, initializeApp } from "firebase/app";
import {
	connectAuthEmulator,
	initializeAuth,
	inMemoryPersistence,
	updateCurrentUser,
} from "firebase/auth";
import {
	connectDatabaseEmulator,
	getDatabase,
	goOffline,
	onDisconnect,
	onValue,
	ref,
	remove,
	set,
	type Database,
	type DatabaseReference,
} from "firebase/database";
import { doc, getDocFromServer } from "firebase/firestore";
import services from "../../lib/firebase";
import { getRuntimeConfig } from "../../lib/runtimeConfig";
import ports from "../../../local-ports.json";
import {
	abortError,
	bounded,
	ProbeError,
	summarize,
	type Metrics,
} from "./connectionTest";

function ensureActive(signal: AbortSignal) {
	if (signal.aborted) throw abortError(signal);
}
async function signedIn(signal: AbortSignal) {
	await services.getOrCreateUserId();
	ensureActive(signal);
	const user = services.auth.currentUser;
	if (!user) throw new ProbeError("not-authenticated");
	return user;
}
export async function firestoreProbe(signal: AbortSignal): Promise<Metrics> {
	await signedIn(signal);
	const samples: number[] = [];
	let attempts = 0,
		failures = 0;
	for (let i = 0; i < 5; i++) {
		ensureActive(signal);
		const start = performance.now();
		attempts++;
		try {
			// Read-only SDK requests cannot be aborted. A timeout stops further reads.
			await bounded(signal, 4000, async () => {
				const snapshot = await getDocFromServer(
					doc(services.db, "rooms", "0000"),
				);
				if (snapshot.exists()) throw new ProbeError("reserved-room-exists");
			});
			samples.push(performance.now() - start);
		} catch {
			ensureActive(signal);
			failures++;
			break;
		}
	}
	return { ...summarize(samples), attempts, failures };
}
function observeOnce(
	reference: DatabaseReference,
	signal: AbortSignal,
	accept: (value: unknown) => boolean,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let stop = () => {};
		const abort = () => {
			stop();
			reject(abortError(signal));
		};
		stop = onValue(
			reference,
			(snapshot) => {
				if (!accept(snapshot.val())) return;
				stop();
				signal.removeEventListener("abort", abort);
				resolve(snapshot.val());
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
}
// Separate app + in-memory auth copies the current user; never signs out or
// disconnects the gameplay client's Auth/Database. No credentials are persisted.
export async function rtdbProbe(signal: AbortSignal): Promise<Metrics> {
	const user = await signedIn(signal);
	const app = initializeApp(
		services.app.options,
		`connection-test-${crypto.randomUUID()}`,
	);
	let database: Database | undefined;
	let stopOffset = () => {};
	const disconnect = () => {
		if (database) goOffline(database);
	};
	signal.addEventListener("abort", disconnect, { once: true });
	try {
		const auth = initializeAuth(app, { persistence: inMemoryPersistence });
		if (getRuntimeConfig().environment === "emulator")
			connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, {
				disableWarnings: true,
			});
		await updateCurrentUser(auth, user);
		ensureActive(signal);
		database = getDatabase(app);
		if (getRuntimeConfig().environment === "emulator")
			connectDatabaseEmulator(database, "127.0.0.1", ports.database);
		const target = ref(database, `cursors/0000/${user.uid}`);
		let offset: number | null = null;
		stopOffset = onValue(
			ref(database, ".info/serverTimeOffset"),
			(snapshot) => {
				const value: unknown = snapshot.val();
				offset =
					typeof value === "number" && Number.isFinite(value) ? value : null;
			},
			() => {
				offset = null;
			},
		);
		const connected = await observeOnce(
			ref(database, ".info/connected"),
			signal,
			(value) => value === true,
		);
		ensureActive(signal);
		// Wait for the server to acknowledge cleanup registration before any write.
		await bounded(signal, 4000, () => onDisconnect(target).remove());
		const samples: number[] = [];
		let failures = 0,
			attempts = 0;
		try {
			for (let i = 0; i < 5; i++) {
				ensureActive(signal);
				attempts++;
				const start = performance.now();
				// set() resolves after server synchronization, not the optimistic onValue.
				await bounded(signal, 3000, () =>
					set(target, { x: 0, y: 0, timestamp: Date.now() }),
				);
				samples.push(performance.now() - start);
			}
			await bounded(signal, 3000, () => remove(target));
		} catch {
			ensureActive(signal);
			failures++;
		}
		return {
			...summarize(samples),
			attempts,
			failures,
			connected: connected === true,
			measured_rtdb_offset_ms: offset,
		};
	} finally {
		signal.removeEventListener("abort", disconnect);
		stopOffset();
		disconnect(); // Registered server-side remove also covers timeout/cancellation.
		void deleteApp(app).catch(() => {});
	}
}
