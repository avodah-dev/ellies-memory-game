/** Verbose gameplay logging is an explicit local-development option. */
export function debugLog(...args: unknown[]) {
	if (import.meta.env.DEV && import.meta.env.VITE_GAME_DEBUG === "true")
		console.log(...args);
}
