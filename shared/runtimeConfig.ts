export interface FirebaseWebConfig {
	apiKey: string;
	projectId: string;
	databaseURL: string;
	authDomain?: string;
	appId?: string;
	storageBucket?: string;
	messagingSenderId?: string;
	measurementId?: string;
}
export type RuntimeConfig =
	| { environment: "emulator"; firebase: null }
	| { environment: "preview" | "production"; firebase: FirebaseWebConfig };

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
	if (!value || typeof value !== "object" || !("environment" in value))
		throw new Error("Application environment is required");
	if (value.environment === "emulator")
		return { environment: "emulator", firebase: null };
	if (value.environment !== "preview" && value.environment !== "production")
		throw new Error("Invalid application environment");
	if (
		!("firebase" in value) ||
		!value.firebase ||
		typeof value.firebase !== "object"
	)
		throw new Error("Firebase web configuration is required");
	const source = value.firebase as Record<string, unknown>;
	const config: Record<string, string> = {};
	// Only public Firebase web fields may ever reach the browser.
	for (const key of [
		"apiKey",
		"projectId",
		"databaseURL",
		"authDomain",
		"appId",
		"storageBucket",
		"messagingSenderId",
		"measurementId",
	]) {
		if (source[key] !== undefined) {
			if (typeof source[key] !== "string" || !source[key])
				throw new Error(`Invalid Firebase field: ${key}`);
			config[key] = source[key];
		}
	}
	if (!config.apiKey || !config.projectId || !config.databaseURL)
		throw new Error("Firebase projectId, apiKey and databaseURL are required");
	if (
		new URL(config.databaseURL).protocol !== "https:" ||
		config.projectId.startsWith("demo-")
	)
		throw new Error(
			"Hosted environments require a real Firebase project and HTTPS database URL",
		);
	return {
		environment: value.environment,
		firebase: config as unknown as FirebaseWebConfig,
	};
}
