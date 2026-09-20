import { afterEach, expect, it, vi } from "vitest";
import {
	connectionInputs,
	connectionRound,
	connectionSignal,
	releaseConnection,
} from "./connection";
import { createTestOnlineGameState } from "../../test/testUtils";
import { track } from "./core";
vi.mock("./core", () => ({ track: vi.fn() }));
afterEach(() => {
	releaseConnection("TEST");
	vi.clearAllMocks();
});
it("emits all three inputs on the first round and replay even when none changed", () => {
	connectionInputs("TEST", true, false, true);
	connectionRound("TEST", createTestOnlineGameState({ gameRound: 1 }));
	expect(track).toHaveBeenLastCalledWith(
		"mm.conn.ready",
		expect.objectContaining({
			game_round: 1,
			ready: false,
			browser_online: true,
			rtdb_connected: false,
			opponent_connected: true,
		}),
	);
	connectionInputs("TEST", true, true, true);
	connectionRound("TEST", createTestOnlineGameState({ gameRound: 2 }));
	for (const source of ["browser", "rtdb", "opponent"])
		expect(track).toHaveBeenCalledWith(
			"mm.conn.input",
			expect.objectContaining({ source, value: true, game_round: 2 }),
		);
});
it("captures intermediate source signals even before React commits a new render", () => {
	connectionInputs("TEST", true, true, true);
	vi.mocked(track).mockClear();
	connectionSignal("TEST", "rtdb", false);
	connectionSignal("TEST", "rtdb", true);
	expect(
		vi.mocked(track).mock.calls.map((c) => (c[1] as { value: boolean }).value),
	).toEqual([false, true]);
});
