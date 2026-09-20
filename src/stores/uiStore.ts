/**
 * uiStore - Transient UI state
 *
 * UI state that doesn't persist across sessions and isn't synced.
 * Things like modal visibility, animation flags, layout metrics.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// ============================================
// Types
// ============================================

export interface LayoutMetrics {
	boardWidth: number;
	boardAvailableHeight: number;
	scoreboardHeight: number;
}

interface UIStoreState {
	// Modal states
	showStartModal: boolean;
	showConnectionTest: boolean;

	// Animation state
	isAnimatingCards: boolean;
	allCardsFlipped: boolean;

	// Layout metrics for auto-sizing
	layoutMetrics: LayoutMetrics;
}

interface UIStoreActions {
	// Modal actions
	setShowStartModal: (show: boolean) => void;
	setShowConnectionTest: (show: boolean) => void;

	// Animation actions
	setIsAnimatingCards: (animating: boolean) => void;
	setAllCardsFlipped: (flipped: boolean) => void;

	// Layout actions
	updateLayoutMetrics: (metrics: LayoutMetrics) => void;

	// Reset
	resetUIState: () => void;
}

type UIStore = UIStoreState & UIStoreActions;

// ============================================
// Initial State
// ============================================

const initialState: UIStoreState = {
	showStartModal: false,
	showConnectionTest: false,
	isAnimatingCards: false,
	allCardsFlipped: false,
	layoutMetrics: {
		boardWidth: 0,
		boardAvailableHeight: 0,
		scoreboardHeight: 0,
	},
};

// ============================================
// Store Implementation
// ============================================

export const useUIStore = create<UIStore>()(
	subscribeWithSelector((set) => ({
		...initialState,

		// Modal actions
		setShowConnectionTest: (show) => set({ showConnectionTest: show }),
		setShowStartModal: (show: boolean) => {
			set({ showStartModal: show });
		},

		// Animation actions
		setIsAnimatingCards: (animating: boolean) => {
			set({ isAnimatingCards: animating });
		},

		setAllCardsFlipped: (flipped: boolean) => {
			set({ allCardsFlipped: flipped });
		},

		// Layout actions
		updateLayoutMetrics: (metrics: LayoutMetrics) => {
			set({ layoutMetrics: metrics });
		},

		// Reset
		resetUIState: () => {
			set(initialState);
		},
	})),
);

// ============================================
// Selectors
// ============================================

export const selectShowStartModal = (state: UIStore) => state.showStartModal;
export const selectIsAnimatingCards = (state: UIStore) =>
	state.isAnimatingCards;
export const selectAllCardsFlipped = (state: UIStore) => state.allCardsFlipped;
export const selectLayoutMetrics = (state: UIStore) => state.layoutMetrics;
