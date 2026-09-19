import { createFirebaseServices } from "./firebaseClient";
import { getRuntimeConfig } from "./runtimeConfig";
const config = getRuntimeConfig();
const services = createFirebaseServices(
	config.environment === "emulator" ? "emulator" : "production",
	"matchimus",
	config.firebase ?? undefined,
);
export const { db, rtdb, auth, getOrCreateUserId } = services;
export default services;
