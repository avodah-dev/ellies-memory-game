import { createTestSettings } from "../test/testUtils";
/**
 * settingsStore Tests
 *
 * Tests for persisted user preferences including player settings,
 * display settings, and game configuration.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStorageMocks, setupStorageMocks } from "../test/mocks/storage";
import {
	selectPlayers,
	selectSettings,
	useSettingsStore,
} from "./settingsStore";

describe("settingsStore", () => {
	beforeEach(() => {
		// Setup mock storage before each test
		setupStorageMocks();
		// Reset store state
		useSettingsStore.setState({
			settings: createTestSettings(),
		});
	});

	afterEach(() => {
		resetStorageMocks();
	});

	// ============================================
	// Initial State Tests
	// ============================================

	describe("initial state", () => {
		it("should have default player names", () => {
			const { settings } = useSettingsStore.getState();
			expect(settings.player1Name).toBe("Player 1");
			expect(settings.player2Name).toBe("Player 2");
		});

		it("should have default player colors", () => {
			const { settings } = useSettingsStore.getState();
			expect(settings.player1Color).toBe("#3b82f6");
			expect(settings.player2Color).toBe("#10b981");
		});

		it("should have first player as 1 by default", () => {
			const { settings } = useSettingsStore.getState();
			expect(settings.firstPlayer).toBe(1);
		});

		it("should have default display settings", () => {
			const { settings } = useSettingsStore.getState();
			expect(settings.cardSize).toBe(100);
			expect(settings.autoSizeEnabled).toBe(true);
			expect(settings.flipDuration).toBe(1500);
		});

		it("should have default game settings", () => {
			const { settings } = useSettingsStore.getState();
			expect(settings.cardPack).toBe("animals");
			expect(settings.background).toBe("default");
			expect(settings.cardBack).toBe("default");
		});

		it("should have default pair counts", () => {
			const { settings } = useSettingsStore.getState();
			expect(settings.localPairCount).toBe(20);
			expect(settings.onlinePairCount).toBe(20);
		});
	});

	// ============================================
	// Player Settings Tests
	// ============================================

	describe("player settings", () => {
		it("should update player 1 name", () => {
			const { setPlayerName } = useSettingsStore.getState();
			setPlayerName(1, "Alice");

			const { settings } = useSettingsStore.getState();
			expect(settings.player1Name).toBe("Alice");
			expect(settings.player2Name).toBe("Player 2"); // unchanged
		});

		it("should update player 2 name", () => {
			const { setPlayerName } = useSettingsStore.getState();
			setPlayerName(2, "Bob");

			const { settings } = useSettingsStore.getState();
			expect(settings.player1Name).toBe("Player 1"); // unchanged
			expect(settings.player2Name).toBe("Bob");
		});

		it("should update player 1 color", () => {
			const { setPlayerColor } = useSettingsStore.getState();
			setPlayerColor(1, "#ff0000");

			const { settings } = useSettingsStore.getState();
			expect(settings.player1Color).toBe("#ff0000");
			expect(settings.player2Color).toBe("#10b981"); // unchanged
		});

		it("should update player 2 color", () => {
			const { setPlayerColor } = useSettingsStore.getState();
			setPlayerColor(2, "#00ff00");

			const { settings } = useSettingsStore.getState();
			expect(settings.player1Color).toBe("#3b82f6"); // unchanged
			expect(settings.player2Color).toBe("#00ff00");
		});

		it("should set first player", () => {
			const { setFirstPlayer } = useSettingsStore.getState();

			setFirstPlayer(2);
			expect(useSettingsStore.getState().settings.firstPlayer).toBe(2);

			setFirstPlayer(1);
			expect(useSettingsStore.getState().settings.firstPlayer).toBe(1);
		});
	});

	// ============================================
	// Display Settings Tests
	// ============================================

	describe("display settings", () => {
		it("should update card size", () => {
			const { setCardSize } = useSettingsStore.getState();
			setCardSize(150);

			expect(useSettingsStore.getState().settings.cardSize).toBe(150);
		});

		it("should toggle auto size", () => {
			const { setAutoSizeEnabled } = useSettingsStore.getState();

			setAutoSizeEnabled(false);
			expect(useSettingsStore.getState().settings.autoSizeEnabled).toBe(false);

			setAutoSizeEnabled(true);
			expect(useSettingsStore.getState().settings.autoSizeEnabled).toBe(true);
		});

		it("should update flip duration", () => {
			const { setFlipDuration } = useSettingsStore.getState();
			setFlipDuration(2000);

			expect(useSettingsStore.getState().settings.flipDuration).toBe(2000);
		});

		it("should toggle white card background", () => {
			const { setUseWhiteCardBackground } = useSettingsStore.getState();

			setUseWhiteCardBackground(true);
			expect(useSettingsStore.getState().settings.useWhiteCardBackground).toBe(
				true,
			);

			setUseWhiteCardBackground(false);
			expect(useSettingsStore.getState().settings.useWhiteCardBackground).toBe(
				false,
			);
		});

		it("should update emoji size percentage", () => {
			const { setEmojiSizePercentage } = useSettingsStore.getState();
			setEmojiSizePercentage(80);

			expect(useSettingsStore.getState().settings.emojiSizePercentage).toBe(80);
		});

		it("should toggle TTS", () => {
			const { setTtsEnabled } = useSettingsStore.getState();

			setTtsEnabled(true);
			expect(useSettingsStore.getState().settings.ttsEnabled).toBe(true);

			setTtsEnabled(false);
			expect(useSettingsStore.getState().settings.ttsEnabled).toBe(false);
		});

		it("should toggle background blur", () => {
			const { setBackgroundBlurEnabled } = useSettingsStore.getState();

			setBackgroundBlurEnabled(false);
			expect(useSettingsStore.getState().settings.backgroundBlurEnabled).toBe(
				false,
			);

			setBackgroundBlurEnabled(true);
			expect(useSettingsStore.getState().settings.backgroundBlurEnabled).toBe(
				true,
			);
		});
	});

	// ============================================
	// Game Settings Tests
	// ============================================

	describe("game settings", () => {
		it("should update card pack", () => {
			const { setCardPack } = useSettingsStore.getState();
			setCardPack("plants");

			expect(useSettingsStore.getState().settings.cardPack).toBe("plants");
		});

		it("should update background", () => {
			const { setBackground } = useSettingsStore.getState();
			setBackground("space");

			expect(useSettingsStore.getState().settings.background).toBe("space");
		});

		it("should update card back", () => {
			const { setCardBack } = useSettingsStore.getState();
			setCardBack("stars");

			expect(useSettingsStore.getState().settings.cardBack).toBe("stars");
		});

		it("should update local pair count", () => {
			const { setLocalPairCount } = useSettingsStore.getState();
			setLocalPairCount(15);

			expect(useSettingsStore.getState().settings.localPairCount).toBe(15);
		});

		it("should update online pair count", () => {
			const { setOnlinePairCount } = useSettingsStore.getState();
			setOnlinePairCount(25);

			expect(useSettingsStore.getState().settings.onlinePairCount).toBe(25);
		});

		it("should keep local and online pair counts independent", () => {
			const { setLocalPairCount, setOnlinePairCount } =
				useSettingsStore.getState();

			setLocalPairCount(10);
			setOnlinePairCount(30);

			const { settings } = useSettingsStore.getState();
			expect(settings.localPairCount).toBe(10);
			expect(settings.onlinePairCount).toBe(30);
		});
	});

	// ============================================
	// Bulk Update Tests
	// ============================================

	describe("bulk update", () => {
		it("should update multiple settings at once", () => {
			const { updateSettings } = useSettingsStore.getState();

			updateSettings({
				player1Name: "Test Player",
				cardPack: "colors",
				localPairCount: 12,
			});

			const { settings } = useSettingsStore.getState();
			expect(settings.player1Name).toBe("Test Player");
			expect(settings.cardPack).toBe("colors");
			expect(settings.localPairCount).toBe(12);
			// Unchanged settings remain
			expect(settings.player2Name).toBe("Player 2");
		});

		it("should not affect unspecified settings", () => {
			const { updateSettings } = useSettingsStore.getState();
			const originalSettings = { ...useSettingsStore.getState().settings };

			updateSettings({ cardSize: 200 });

			const { settings } = useSettingsStore.getState();
			expect(settings.cardSize).toBe(200);
			// All other settings unchanged
			expect(settings.player1Name).toBe(originalSettings.player1Name);
			expect(settings.player2Name).toBe(originalSettings.player2Name);
			expect(settings.cardPack).toBe(originalSettings.cardPack);
		});
	});

	// ============================================
	// Selector Tests
	// ============================================

	describe("selectors", () => {
		it("selectSettings should return all settings", () => {
			const state = useSettingsStore.getState();
			const settings = selectSettings(state);

			expect(settings).toBe(state.settings);
			expect(settings.player1Name).toBe("Player 1");
		});

		it("selectPlayers should derive player array from settings", () => {
			const { setPlayerName, setPlayerColor } = useSettingsStore.getState();
			setPlayerName(1, "Alice");
			setPlayerColor(1, "#ff0000");
			setPlayerName(2, "Bob");
			setPlayerColor(2, "#00ff00");

			const state = useSettingsStore.getState();
			const players = selectPlayers(state);

			expect(players).toHaveLength(2);
			expect(players[0]).toEqual({ id: 1, name: "Alice", color: "#ff0000" });
			expect(players[1]).toEqual({ id: 2, name: "Bob", color: "#00ff00" });
		});
	});

	// ============================================
	// Edge Cases
	// ============================================

	describe("edge cases", () => {
		it("should handle empty string player names", () => {
			const { setPlayerName } = useSettingsStore.getState();
			setPlayerName(1, "");

			expect(useSettingsStore.getState().settings.player1Name).toBe("");
		});

		it("should handle very long player names", () => {
			const { setPlayerName } = useSettingsStore.getState();
			const longName = "A".repeat(100);
			setPlayerName(1, longName);

			expect(useSettingsStore.getState().settings.player1Name).toBe(longName);
		});

		it("should handle zero card size", () => {
			const { setCardSize } = useSettingsStore.getState();
			setCardSize(0);

			expect(useSettingsStore.getState().settings.cardSize).toBe(0);
		});

		it("should handle zero pair count", () => {
			const { setLocalPairCount } = useSettingsStore.getState();
			setLocalPairCount(0);

			expect(useSettingsStore.getState().settings.localPairCount).toBe(0);
		});
	});
});
