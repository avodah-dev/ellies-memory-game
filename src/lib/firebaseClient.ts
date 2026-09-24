import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
	connectAuthEmulator,
	initializeAuth,
	browserLocalPersistence,
	inMemoryPersistence,
	onAuthStateChanged,
	signInAnonymously,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
import ports from "../../local-ports.json";
import { firestoreTransport } from "./firestoreTransport";

export const emulatorProject = "demo-matchimus";
export function createFirebaseServices(
	mode: "emulator" | "production",
	name: string,
	productionConfig?: FirebaseOptions,
) {
	if (
		mode === "production" &&
		(!productionConfig?.projectId ||
			!productionConfig.apiKey ||
			!productionConfig.databaseURL)
	)
		throw new Error("Production Firebase configuration is required");
	const config: FirebaseOptions =
		mode === "emulator"
			? {
					projectId: emulatorProject,
					apiKey: "demo-key",
					appId: "demo-matchimus-web",
					authDomain: "localhost",
					databaseURL: `http://127.0.0.1:${ports.database}?ns=${emulatorProject}-default-rtdb`,
				}
			: productionConfig!;
	const app = initializeApp(config, name);
	const auth = initializeAuth(app, {
		persistence:
			typeof window === "undefined"
				? inMemoryPersistence
				: browserLocalPersistence,
	});
	const db = initializeFirestore(app, firestoreTransport.settings, "main-firestore");
	const rtdb = getDatabase(app);
	if (mode === "emulator") {
		connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`, {
			disableWarnings: true,
		});
		connectFirestoreEmulator(db, "127.0.0.1", ports.firestore);
		connectDatabaseEmulator(rtdb, "127.0.0.1", ports.database);
	}
	const getOrCreateUserId = async () => {
		const user = await new Promise<import("firebase/auth").User | null>(
			(resolve, reject) => {
				const unsubscribe = onAuthStateChanged(
					auth,
					(u) => {
						unsubscribe();
						resolve(u);
					},
					reject,
				);
			},
		);
		return (user ?? (await signInAnonymously(auth)).user).uid;
	};
	return { app, auth, db, rtdb, getOrCreateUserId };
}
export type FirebaseServices = ReturnType<typeof createFirebaseServices>;
