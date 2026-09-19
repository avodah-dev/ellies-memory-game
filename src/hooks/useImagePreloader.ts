import { debugLog } from "../utils/debugLog";
/**
 * useImagePreloader - Hook to preload game assets
 *
 * Preloads background images, card back images, and card deck images
 * when enabled, ensuring everything is cached before the game starts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_DECKS } from "../data/cardDecks";
import type { CardPack } from "../types";
import { preloadImages } from "../utils/imagePreloader";
import {
	BACKGROUND_OPTIONS,
	type BackgroundTheme,
} from "./useBackgroundSelector";
import { CARD_BACK_OPTIONS, type CardBackType } from "./useCardBackSelector";

interface PreloadState {
	isLoading: boolean;
	isComplete: boolean;
	loaded: number;
	failed: number;
	total: number;
}

interface UseImagePreloaderOptions {
	/** The selected background theme */
	background: BackgroundTheme;
	/** The selected card back type */
	cardBack: CardBackType;
	/** The selected card pack */
	cardPack: CardPack;
	/** Number of pairs to preload (uses all deck cards if not specified) */
	pairCount?: number;
	/** Whether preloading should be enabled */
	enabled: boolean;
}

/**
 * Collects all image URLs that need to be preloaded based on current selections.
 */
function collectImageUrls(
	background: BackgroundTheme,
	cardBack: CardBackType,
	cardPack: CardPack,
	pairCount?: number,
): string[] {
	const urls: string[] = [];

	// 1. Background image (if it has an imageUrl)
	const bgOption = BACKGROUND_OPTIONS.find((bg) => bg.id === background);
	if (bgOption?.imageUrl) {
		urls.push(bgOption.imageUrl);
	}

	// 2. Card back image (if it has an imageUrl)
	const cbOption = CARD_BACK_OPTIONS.find((cb) => cb.id === cardBack);
	if (cbOption?.imageUrl) {
		urls.push(cbOption.imageUrl);
	}

	// 3. Card deck images
	const deck = CARD_DECKS.find((d) => d.id === cardPack);
	if (deck) {
		// Get all cards with imageUrls
		const cardsWithImages = deck.cards.filter((card) => card.imageUrl);

		// If pairCount is specified, only preload that many cards
		// Otherwise preload all cards in the deck
		const cardsToPreload = pairCount
			? cardsWithImages.slice(0, pairCount)
			: cardsWithImages;

		for (const card of cardsToPreload) {
			if (card.imageUrl) {
				urls.push(card.imageUrl);
			}
		}
	}

	return urls;
}

/**
 * Hook to preload game images before the game starts.
 *
 * Usage:
 * ```ts
 * const { isLoading, isComplete, progress } = useImagePreloader({
 *   background: selectedBackground,
 *   cardBack: selectedCardBack,
 *   cardPack: selectedPack,
 *   pairCount: localPairCount,
 *   enabled: setupStep === 'startGame',
 * });
 * ```
 */
export function useImagePreloader({
	background,
	cardBack,
	cardPack,
	pairCount,
	enabled,
}: UseImagePreloaderOptions): PreloadState & { progress: number } {
	const [state, setState] = useState<PreloadState>({
		isLoading: false,
		isComplete: false,
		loaded: 0,
		failed: 0,
		total: 0,
	});

	// Track what we've already preloaded to avoid redundant work
	const preloadedRef = useRef<Set<string>>(new Set());
	// Track if we're currently preloading to avoid race conditions
	const isPreloadingRef = useRef(false);

	const preload = useCallback(async () => {
		if (isPreloadingRef.current) return;

		const urls = collectImageUrls(background, cardBack, cardPack, pairCount);

		// Filter out already preloaded URLs
		const newUrls = urls.filter((url) => !preloadedRef.current.has(url));

		if (newUrls.length === 0) {
			// Everything already preloaded
			setState((prev) => ({
				...prev,
				isComplete: true,
				isLoading: false,
			}));
			return;
		}

		isPreloadingRef.current = true;
		setState({
			isLoading: true,
			isComplete: false,
			loaded: 0,
			failed: 0,
			total: newUrls.length,
		});

		debugLog(
			`[ImagePreloader] Preloading ${newUrls.length} images...`,
			newUrls,
		);

		try {
			const result = await preloadImages(newUrls);

			// Mark successfully loaded URLs as preloaded
			for (const url of newUrls) {
				preloadedRef.current.add(url);
			}

			debugLog(
				`[ImagePreloader] Preload complete: ${result.loaded}/${result.total} loaded, ${result.failed} failed`,
			);

			setState({
				isLoading: false,
				isComplete: true,
				loaded: result.loaded,
				failed: result.failed,
				total: result.total,
			});
		} catch (error) {
			console.error("[ImagePreloader] Preload error:", error);
			setState((prev) => ({
				...prev,
				isLoading: false,
				isComplete: true,
			}));
		} finally {
			isPreloadingRef.current = false;
		}
	}, [background, cardBack, cardPack, pairCount]);

	// Trigger preload when enabled changes to true
	useEffect(() => {
		if (enabled) {
			preload();
		}
	}, [enabled, preload]);

	// Calculate progress as a percentage
	const progress =
		state.total > 0
			? Math.round(((state.loaded + state.failed) / state.total) * 100)
			: 0;

	return {
		...state,
		progress,
	};
}
