import {
	parseRuntimeConfig,
	type RuntimeConfig,
} from "../../shared/runtimeConfig";
let configured: RuntimeConfig | undefined;
export async function initializeRuntimeConfig(): Promise<RuntimeConfig> {
	if (import.meta.env.MODE !== "production") {
		configured = { environment: "emulator", firebase: null, telemetry: "on" };
	} else {
		const response = await fetch("/app-config.json", {
			cache: "no-store",
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok)
			throw new Error("Application configuration is unavailable");
		configured = parseRuntimeConfig(await response.json());
	}
	return configured;
}
export function getRuntimeConfig(): RuntimeConfig {
	if (import.meta.env.MODE !== "production")
		return { environment: "emulator", firebase: null, telemetry: "on" };
	if (!configured)
		throw new Error("Application configuration has not been initialized");
	return configured;
}
