import { counters } from "../services/telemetry/core";
import { usePaintProbe } from "../services/telemetry/usePaintProbe";
import { debugLog } from "../utils/debugLog";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CardBackOption } from "../hooks/useCardBackSelector";
import type { Card as CardType, CursorPosition } from "../types";
import { calculateGridDimensions } from "../utils/gridLayout";
import { Card } from "./Card";
import { CardLightbox } from "./CardLightbox";
import { RemoteCursor } from "./online/RemoteCursor";

interface RemoteCursorData {
	position: CursorPosition;
	playerName: string;
	playerColor: string;
}

interface GameBoardProps {
	cards: CardType[];
	onCardClick: (cardId: string) => void;
	cardSize?: number;
	isAnimating?: boolean;
	useWhiteCardBackground?: boolean;
	emojiSizePercentage?: number;
	cardBack?: CardBackOption;
	// Grid configuration - if not provided, derived from card count
	columns?: number;
	// Cursor tracking props (for online mode)
	onCursorMove?: (
		event: React.MouseEvent<HTMLDivElement>,
		boardRect: DOMRect,
	) => void;
	onCursorLeave?: () => void;
	remoteCursor?: RemoteCursorData | null;
}

interface CardAnimationData {
	startX: number;
	startY: number;
	rotation: number;
}

// Type for stored fly animation data
interface FlyData {
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	finalY: number;
	rotationAngle: number;
	playerId: number | undefined;
}

// Type for cached card position (captured when card is flipped)
interface CachedCardPosition {
	left: number;
	top: number;
	width: number;
	height: number;
}

// Type for local flying card state
interface FlyingCardState {
	playerId: number | undefined;
	flyData: FlyData;
	card: CardType;
}

export const GameBoard = ({
	cards,
	onCardClick,
	cardSize = 100,
	isAnimating = false,
	useWhiteCardBackground = false,
	emojiSizePercentage = 72,
	cardBack,
	columns: columnsProp,
	onCursorMove,
	onCursorLeave,
	remoteCursor,
}: GameBoardProps) => {
	counters.boardRenders++;
	usePaintProbe(cards);
	const [lightboxCardId, setLightboxCardId] = useState<string | null>(null);
	const boardRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

	// LOCAL animation state - flying cards are tracked locally, not synced
	const [flyingCards, setFlyingCards] = useState<Map<string, FlyingCardState>>(
		new Map(),
	);

	// Track previous matched state to detect match transitions
	const prevMatchedRef = useRef<Set<string>>(new Set());

	// Cache card positions when they get flipped - used to calculate fly data
	const cardPositionCache = useRef<Map<string, CachedCardPosition>>(new Map());

	// Calculate columns from card count if not provided
	const columns = useMemo(() => {
		if (columnsProp) return columnsProp;
		// Derive pair count from card count (cards / 2)
		const pairCount = Math.floor(cards.length / 2);
		return calculateGridDimensions(pairCount).columns;
	}, [columnsProp, cards.length]);

	const gap = 8; // Gap between cards in pixels

	// Handle mouse move on the board
	const handleMouseMove = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (onCursorMove && boardRef.current) {
				const rect = boardRef.current.getBoundingClientRect();
				onCursorMove(event, rect);
			}
		},
		[onCursorMove],
	);

	// Handle mouse leave
	const handleMouseLeave = useCallback(() => {
		if (onCursorLeave) {
			onCursorLeave();
		}
	}, [onCursorLeave]);

	// Animation cleanup never controls game rules or persistence.
	const handleFlyingCardAnimationEnd = useCallback((cardId: string) => {
		cardPositionCache.current.delete(cardId);
		setFlyingCards((previous) => {
			const next = new Map(previous);
			next.delete(cardId);
			return next;
		});
	}, []);

	// Monitor card state changes for debugging
	useEffect(() => {
		const flippedCards = cards.filter((c) => c.isFlipped && !c.isMatched);
		const matchedCards = cards.filter((c) => c.isMatched);

		debugLog(
			"[CARD STATE] Cards state changed",
			JSON.stringify({
				totalCards: cards.length,
				flippedCardsCount: flippedCards.length,
				flippedCards: flippedCards.map((c) => ({
					id: c.id,
					isFlipped: c.isFlipped,
					isMatched: c.isMatched,
				})),
				flyingCardsCount: flyingCards.size,
				matchedCardsCount: matchedCards.length,
				timestamp: new Date().toISOString(),
			}),
		);
	}, [cards, flyingCards.size]);

	// Generate random starting positions and rotations for each card
	const animationData = useMemo<CardAnimationData[]>(() => {
		if (!isAnimating) return [];

		// Get the game board container position (we'll need to calculate offsets relative to viewport)
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		return cards.map((_, index) => {
			// Calculate card's position in grid using dynamic columns
			const col = index % columns;
			const row = Math.floor(index / columns);

			// Estimate card's final position (center of game board)
			const boardWidth = cardSize * columns + gap * (columns - 1);
			const boardLeft = (viewportWidth - boardWidth) / 2;
			const cardCenterX = boardLeft + col * (cardSize + gap) + cardSize / 2;
			const cardCenterY =
				viewportHeight / 2 + row * (cardSize + gap) - cardSize / 2;

			// Random edge: 0 = top, 1 = right, 2 = bottom, 3 = left
			const edge = Math.floor(Math.random() * 4);

			// Calculate offset from card's final position to screen edge
			let offsetX: number, offsetY: number;

			switch (edge) {
				case 0: // Top - card comes from above
					offsetX = (Math.random() - 0.5) * 400; // Some horizontal variation
					offsetY = -viewportHeight - cardCenterY - 200; // Way above the card
					break;
				case 1: // Right - card comes from right
					offsetX = viewportWidth - cardCenterX + 200; // Way to the right
					offsetY = (Math.random() - 0.5) * 400; // Some vertical variation
					break;
				case 2: // Bottom - card comes from below
					offsetX = (Math.random() - 0.5) * 400; // Some horizontal variation
					offsetY = viewportHeight - cardCenterY + 200; // Way below the card
					break;
				case 3: // Left - card comes from left
					offsetX = -cardCenterX - 200; // Way to the left
					offsetY = (Math.random() - 0.5) * 400; // Some vertical variation
					break;
				default:
					offsetX = 0;
					offsetY = -viewportHeight;
			}

			// Random rotation between -720 and 720 degrees (2 full spins either direction)
			const rotation = (Math.random() - 0.5) * 1440;

			return {
				startX: offsetX,
				startY: offsetY,
				rotation,
			};
		});
	}, [isAnimating, cardSize, cards, columns]);

	// Cache card positions when they get flipped (before they might become matched)
	// This ensures we have position data available when calculating fly animations
	useLayoutEffect(() => {
		// Find cards that are flipped but not matched (selected cards)
		const selectedCards = cards.filter((c) => c.isFlipped && !c.isMatched);

		for (const card of selectedCards) {
			// Only cache if we don't already have a position for this card
			if (!cardPositionCache.current.has(card.id)) {
				const cardElement = cardRefs.current.get(card.id);
				if (cardElement) {
					const rect = cardElement.getBoundingClientRect();
					cardPositionCache.current.set(card.id, {
						left: rect.left,
						top: rect.top,
						width: rect.width,
						height: rect.height,
					});
					debugLog("[POSITION CACHE] Cached position for flipped card", {
						cardId: card.id,
						rect: { left: rect.left, top: rect.top },
					});
				}
			}
		}
	}, [cards]);

	// Detect match transitions and trigger local flying animation
	useEffect(() => {
		const currentMatched = new Set(
			cards.filter((c) => c.isMatched).map((c) => c.id),
		);
		const prevMatched = prevMatchedRef.current;

		// Find newly matched cards (cards that just transitioned to isMatched: true)
		const newlyMatched: CardType[] = [];
		for (const card of cards) {
			if (card.isMatched && !prevMatched.has(card.id)) {
				newlyMatched.push(card);
			}
		}

		// If we have newly matched cards, trigger flying animation
		if (newlyMatched.length > 0) {
			debugLog("[MATCH TRANSITION] Detected newly matched cards", {
				newlyMatched: newlyMatched.map((c) => c.id),
				matchedByPlayerId: newlyMatched[0]?.matchedByPlayerId,
			});

			const newFlyingCards = new Map(flyingCards);

			for (const card of newlyMatched) {
				// Try to get position from cache (captured when card was flipped)
				let rect = cardPositionCache.current.get(card.id);

				// Fallback: try to get from DOM ref (might still exist on first render)
				if (!rect) {
					const cardElement = cardRefs.current.get(card.id);
					if (cardElement) {
						const domRect = cardElement.getBoundingClientRect();
						rect = {
							left: domRect.left,
							top: domRect.top,
							width: domRect.width,
							height: domRect.height,
						};
					}
				}

				if (!rect) {
					console.warn("[FLY DATA] No position data for matched card", {
						cardId: card.id,
					});
					continue;
				}

				// Calculate card's actual center position
				const cardCenterX = rect.left + rect.width / 2;
				const cardCenterY = rect.top + rect.height / 2;

				// Calculate target position (next to player name)
				// Player 1 is on the left, Player 2 is on the right
				const headerY = 120; // Approximate header Y position
				const viewportWidth = window.innerWidth;
				const playerId = card.matchedByPlayerId;
				const targetX =
					playerId === 1
						? viewportWidth * 0.25 // Left side for Player 1
						: viewportWidth * 0.75; // Right side for Player 2

				// Calculate rotation angle based on direction from card to player name
				const deltaX = targetX - cardCenterX;
				const deltaY = headerY - cardCenterY;
				const rotationAngle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

				// Final position: continue off screen above the player name
				const finalY = -cardSize - 50; // Off screen above

				const flyData: FlyData = {
					startX: rect.left,
					startY: rect.top,
					endX: targetX - cardSize / 2,
					endY: headerY - cardSize * 1.0, // Higher up to be more out of the way
					finalY: finalY,
					rotationAngle: rotationAngle,
					playerId: playerId,
				};

				debugLog("[FLY DATA] Calculated fly data for card", {
					cardId: card.id,
					source: cardPositionCache.current.has(card.id) ? "cache" : "dom",
					positions: {
						start: { x: flyData.startX, y: flyData.startY },
						end: { x: flyData.endX, y: flyData.endY },
					},
					rotationAngle: flyData.rotationAngle,
					playerId: flyData.playerId,
				});

				newFlyingCards.set(card.id, {
					playerId: playerId,
					flyData: flyData,
					card: card,
				});
			}

			setFlyingCards(newFlyingCards);
			// Note: Flying cards are now cleaned up via onAnimationEnd handler instead of setTimeout
		}

		// Update previous matched state
		prevMatchedRef.current = currentMatched;
	}, [cards, cardSize, flyingCards]);

	// Clean up position cache for cards that are no longer relevant
	useEffect(() => {
		for (const [cardId] of cardPositionCache.current) {
			const card = cards.find((c) => c.id === cardId);
			const isFlying = flyingCards.has(cardId);
			if (card && !card.isFlipped && !isFlying) {
				cardPositionCache.current.delete(cardId);
			}
		}
	}, [cards, flyingCards]);

	return (
		<>
			{/* Flying cards overlay - now uses local state */}
			{Array.from(flyingCards.entries()).map(([cardId, flyingState]) => {
				const { flyData, card } = flyingState;

				debugLog("[RENDER] Rendering flying card overlay", {
					cardId: cardId,
					style: {
						left: `${flyData.startX}px`,
						top: `${flyData.startY}px`,
						"--end-x": `${flyData.endX - flyData.startX}px`,
						"--end-y": `${flyData.endY - flyData.startY}px`,
						"--final-y": `${flyData.finalY - flyData.startY}px`,
						"--rotation-angle": `${flyData.rotationAngle}deg`,
					},
				});

				return (
					<div
						key={`flying-${cardId}`}
						className="fixed z-50 card-fly-to-player"
						onAnimationEnd={() => handleFlyingCardAnimationEnd(cardId)}
						style={
							{
								left: `${flyData.startX}px`,
								top: `${flyData.startY}px`,
								"--end-x": `${flyData.endX - flyData.startX}px`,
								"--end-y": `${flyData.endY - flyData.startY}px`,
								"--final-y": `${flyData.finalY - flyData.startY}px`,
								"--rotation-angle": `${flyData.rotationAngle}deg`,
							} as React.CSSProperties & {
								"--end-x": string;
								"--end-y": string;
								"--final-y": string;
								"--rotation-angle": string;
							}
						}
					>
						<Card
							card={card}
							onClick={() => setLightboxCardId(cardId)}
							size={cardSize}
							useWhiteBackground={useWhiteCardBackground}
							emojiSizePercentage={emojiSizePercentage}
							cardBack={cardBack}
						/>
					</div>
				);
			})}

			<CardLightbox
				isOpen={!!lightboxCardId}
				onClose={() => setLightboxCardId(null)}
				card={
					lightboxCardId
						? cards.find((c) => c.id === lightboxCardId) || null
						: null
				}
			/>

			<div
				ref={boardRef}
				className="grid gap-2 max-w-none mx-auto justify-center relative"
				style={{
					perspective: "1000px",
					gridTemplateColumns: `repeat(${columns}, ${cardSize}px)`,
					width: `${cardSize * columns + gap * (columns - 1)}px`,
				}}
				onMouseMove={handleMouseMove}
				onMouseLeave={handleMouseLeave}
				role="application"
				aria-label="Game board"
			>
				{/* Remote cursor overlay */}
				{remoteCursor && (
					<RemoteCursor
						position={remoteCursor.position}
						cardSize={cardSize}
						gap={8}
						playerName={remoteCursor.playerName}
						playerColor={remoteCursor.playerColor}
					/>
				)}

				{cards.map((card, index) => {
					// Show placeholder for matched cards OR cards currently flying (local state)
					const isFlying = flyingCards.has(card.id);
					const shouldShowPlaceholder = card.isMatched || isFlying;

					if (shouldShowPlaceholder) {
						debugLog("[RENDER] Showing placeholder for card", {
							cardId: card.id,
							index,
							isMatched: card.isMatched,
							isFlying: isFlying,
							reason: card.isMatched ? "matched" : "flying",
						});
					}

					return shouldShowPlaceholder ? (
						// Placeholder for matched cards (or cards that are flying)
						<div
							key={card.id}
							className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 opacity-15"
							style={{
								width: `${cardSize}px`,
								height: `${cardSize}px`,
							}}
						/>
					) : (
						<div
							key={card.id}
							ref={(el) => {
								if (el) {
									cardRefs.current.set(card.id, el);
								} else {
									cardRefs.current.delete(card.id);
								}
							}}
							className={isAnimating ? "card-fly-in" : ""}
							style={
								{
									animationDelay: isAnimating ? `${index * 30}ms` : "0ms",
									"--start-x":
										isAnimating && animationData[index]
											? `${animationData[index].startX}px`
											: "0px",
									"--start-y":
										isAnimating && animationData[index]
											? `${animationData[index].startY}px`
											: "0px",
									"--rotation":
										isAnimating && animationData[index]
											? `${animationData[index].rotation}deg`
											: "0deg",
								} as React.CSSProperties & {
									"--start-x": string;
									"--start-y": string;
									"--rotation": string;
								}
							}
						>
							<Card
								card={card}
								onClick={() => onCardClick(card.id)}
								size={cardSize}
								useWhiteBackground={useWhiteCardBackground}
								emojiSizePercentage={emojiSizePercentage}
								cardBack={cardBack}
							/>
						</div>
					);
				})}
			</div>
		</>
	);
};
