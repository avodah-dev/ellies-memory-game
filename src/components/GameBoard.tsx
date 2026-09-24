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
import type { Card as CardType } from "../types";
import { calculateGridDimensions } from "../utils/gridLayout";
import { Card } from "./Card";
import { OpponentCursor, type CursorPeer } from "./online/OpponentCursor";

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
	remoteCursorPeer?: CursorPeer | null;
}

interface CardAnimationData {
	startX: number;
	startY: number;
	rotation: number;
}

// Type for stored fly animation data
interface FlyData {
	initialTransform: string;
	initialOpacity: string;
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	finalY: number;
	rotationAngle: number;
	playerId: number | undefined;
}

// Type for local flying card state
interface FlyingCardState {
	flyData: FlyData;
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
	remoteCursorPeer,
}: GameBoardProps) => {
	counters.boardRenders++;
	usePaintProbe(cards);
	const boardRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

	// LOCAL animation state - flying cards are tracked locally, not synced
	const [flyingCards, setFlyingCards] = useState<Map<string, FlyingCardState>>(
		new Map(),
	);

	// Only animate transitions observed by this mounted board, not old matches
	// already present when joining or returning to a game.
	const prevMatchedRef = useRef<Set<string> | null>(null);
	if (prevMatchedRef.current === null)
		prevMatchedRef.current = new Set(
			cards.filter((c) => c.isMatched).map((c) => c.id),
		);

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

	// Start the flight before paint, keeping the existing face/image mounted.
	useLayoutEffect(() => {
		const currentMatched = new Set(
			cards.filter((c) => c.isMatched).map((c) => c.id),
		);
		const prevMatched = prevMatchedRef.current!; // Initialized during render.

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
				const cell = cardRefs.current.get(card.id)!;
				// The cell never transforms. Transfer the current deal pose into the
				// flight on the SAME face, so the two animations cannot compose.
				const rect = cell.getBoundingClientRect();
				const faceStyle = getComputedStyle(cell.lastElementChild!);

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
					initialTransform: faceStyle.transform || "none",
					initialOpacity: faceStyle.opacity || "1",
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
					source: "dom",
					positions: {
						start: { x: flyData.startX, y: flyData.startY },
						end: { x: flyData.endX, y: flyData.endY },
					},
					rotationAngle: flyData.rotationAngle,
					playerId: flyData.playerId,
				});

				newFlyingCards.set(card.id, { flyData });
			}

			setFlyingCards(newFlyingCards);
			// Note: Flying cards are now cleaned up via onAnimationEnd handler instead of setTimeout
		}

		// Update previous matched state
		prevMatchedRef.current = currentMatched;
	}, [cards, cardSize, flyingCards]);

	return (
		<>
			<div
				ref={boardRef}
				className="grid gap-2 max-w-none mx-auto justify-center relative"
				style={{
					perspective: "1000px",
					// Let decorative flights pass over the score header.
					zIndex: flyingCards.size > 0 ? 20 : undefined,
					gridTemplateColumns: `repeat(${columns}, ${cardSize}px)`,
					width: `${cardSize * columns + gap * (columns - 1)}px`,
				}}
				onMouseMove={handleMouseMove}
				onMouseLeave={handleMouseLeave}
				role="application"
				aria-label="Game board"
			>
				{/* Remote cursor overlay */}
				{remoteCursorPeer && (
					<OpponentCursor
						key={`${remoteCursorPeer.roomCode}:${remoteCursorPeer.opponentOdahId}`}
						{...remoteCursorPeer}
						cardSize={cardSize}
						gap={8}
					/>
				)}

				{cards.map((card, index) => {
					const flight = flyingCards.get(card.id)?.flyData;
					// A newly matched face stays mounted for the layout effect to start
					// its flight. Only completed/historical matches drop the face.
					const keepFace =
						!card.isMatched ||
						!!flight ||
						!prevMatchedRef.current!.has(card.id);
					return (
						<div
							key={card.id}
							ref={(el) => {
								if (el) cardRefs.current.set(card.id, el);
								else cardRefs.current.delete(card.id);
							}}
							className="relative"
							style={{ width: cardSize, height: cardSize }}
						>
							<div
								aria-hidden="true"
								className="absolute inset-0 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 opacity-15 pointer-events-none"
								style={{ visibility: card.isMatched ? "visible" : "hidden" }}
							/>
							{keepFace && (
								<div
									className={
										flight
											? "absolute inset-0 z-50 card-fly-to-player pointer-events-none"
											: isAnimating
												? "absolute inset-0 card-fly-in"
												: "absolute inset-0"
									}
									onAnimationEnd={
										flight
											? (event) => {
													if (event.target === event.currentTarget)
														handleFlyingCardAnimationEnd(card.id);
												}
											: undefined
									}
									style={
										flight
											? ({
													"--flight-start-transform": flight.initialTransform,
													"--flight-start-opacity": flight.initialOpacity,
													"--end-x": `${flight.endX - flight.startX}px`,
													"--end-y": `${flight.endY - flight.startY}px`,
													"--final-y": `${flight.finalY - flight.startY}px`,
													"--rotation-angle": `${flight.rotationAngle}deg`,
												} as React.CSSProperties)
											: ({
													animationDelay: isAnimating
														? `${index * 30}ms`
														: "0ms",
													"--start-x": `${animationData[index]?.startX ?? 0}px`,
													"--start-y": `${animationData[index]?.startY ?? 0}px`,
													"--rotation": `${animationData[index]?.rotation ?? 0}deg`,
												} as React.CSSProperties)
									}
								>
									<Card
										card={card}
										onClick={() => onCardClick(card.id)}
										size={cardSize}
										useWhiteBackground={useWhiteCardBackground}
										emojiSizePercentage={emojiSizePercentage}
										cardBack={cardBack}
										forceGameplaySize
										forceGameplayBackground
									/>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</>
	);
};
