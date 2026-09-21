import { isCardImageSource } from "../utils/cardImage";
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_DECKS } from "../data/cardDecks";
import { useTextToSpeech } from "../hooks/useTextToSpeech";
import type { Card } from "../types";

interface CardLightboxProps {
	isOpen: boolean;
	onClose: () => void;
	card: Card | null;
	cards?: Card[];
	currentIndex?: number;
	onNavigate?: (index: number) => void;
}

// Helper function to format imageId into a readable name
const formatCardName = (imageId: string): string => {
	// Find the card in any deck
	for (const deck of CARD_DECKS) {
		const cardData = deck.cards.find((c) => c.id === imageId);
		if (cardData) {
			// Convert kebab-case to Title Case (e.g., 'very-happy' -> 'Very Happy')
			return imageId
				.split("-")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ");
		}
	}
	// Fallback: format the imageId itself
	return imageId
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
};

// Reusable card content component
const CardContent = ({
	card,
	cardName,
	speak,
	isAvailable,
}: {
	card: Card;
	cardName: string;
	speak: (text: string) => void;
	isAvailable: () => boolean;
}) => {
	const isImage = isCardImageSource(card.imageUrl);

	return (
		<>
			{isImage ? (
				<img
					src={card.imageUrl}
					alt=""
					className="w-full h-full object-contain"
				/>
			) : (
				<div
					className={`relative w-full h-full flex items-center justify-center ${
						card.gradient ? `bg-gradient-to-br ${card.gradient}` : "bg-white"
					}`}
				>
					{card.gradient && (
						<div className="absolute inset-0 bg-white opacity-30" />
					)}
					<div
						className="text-center relative z-10"
						style={{ fontSize: "min(52.25vmin, 200px)" }}
					>
						{card.imageUrl || "?"}
					</div>
				</div>
			)}

			{/* Card Name Overlay */}
			<div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 md:p-8">
				<div className="flex items-center justify-center gap-3">
					<h2
						className="text-white text-center text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold"
						style={{
							textShadow:
								"0 0 10px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 0, 0, 0.6), 0 2px 4px rgba(0, 0, 0, 0.9)",
						}}
					>
						{cardName}
					</h2>
					{isAvailable() && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								speak(cardName);
							}}
							className="p-2 sm:p-3 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-white/30 text-white transition-colors flex-shrink-0 shadow-lg"
							type="button"
							title="Read name aloud"
							style={{
								boxShadow:
									"0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)",
							}}
						>
							<svg
								className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 drop-shadow-lg"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}
								aria-hidden="true"
							>
								<title>Speak</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
								/>
							</svg>
						</button>
					)}
				</div>
			</div>
		</>
	);
};

export const CardLightbox = ({
	isOpen,
	onClose,
	card,
	cards = [],
	currentIndex = 0,
	onNavigate,
}: CardLightboxProps) => {
	// Input can arrive before React paints the preceding event. Keep gesture
	// decisions synchronous; state below controls only the rendered animation.
	const gestureRef = useRef<{
		x: number;
		y: number;
		offset: number;
		started: number;
	} | null>(null);
	const animationGeneration = useRef(0);
	const transitionActive = useRef(false);
	useEffect(
		() => () => {
			++animationGeneration.current;
			gestureRef.current = null;
		},
		[],
	);
	const [swipeOffset, setSwipeOffset] = useState(0);
	const [isSwiping, setIsSwiping] = useState(false);
	const [isPositioning, setIsPositioning] = useState(false);

	// Outgoing card state (for simultaneous animations)
	const [outgoingCard, setOutgoingCard] = useState<Card | null>(null);
	const [outgoingOffset, setOutgoingOffset] = useState(0);

	// Incoming card state
	const [incomingOffset, setIncomingOffset] = useState(0);

	const cardContainerRef = useRef<HTMLDivElement>(null);
	const { speak, isAvailable } = useTextToSpeech();

	// Animation config
	const transitionTime = 250;
	const screenWidth = typeof window !== "undefined" ? window.innerWidth : 800;
	const minSwipeDistance = screenWidth / 2;
	const velocityThreshold = 0.3;

	// Calculate rotation based on swipe (subtle tilt effect)
	const outgoingRotation = (outgoingOffset / screenWidth) * 8;

	// Disable transition when actively swiping or positioning
	const disableTransition = isSwiping || isPositioning;

	// Check if navigation is possible
	const canNavigate = cards.length > 1 && onNavigate;
	const isTransitioning = outgoingCard !== null;

	// Trigger a transition with both cards animating
	const triggerTransition = useCallback(
		(direction: "left" | "right", nextIndex: number, startOffset = 0) => {
			if (!card || !onNavigate || transitionActive.current) return;
			transitionActive.current = true;
			const generation = ++animationGeneration.current;

			// Store current card as outgoing
			setOutgoingCard(card);
			setOutgoingOffset(startOffset);

			// Set target for outgoing card (exit direction)
			const exitOffset = direction === "right" ? -screenWidth : screenWidth;

			// Position incoming card off-screen on opposite side
			const entryOffset = direction === "right" ? screenWidth : -screenWidth;
			setIncomingOffset(entryOffset);
			setIsPositioning(true);

			// Navigate immediately (new card appears)
			onNavigate(nextIndex);

			// Start animations on next frame
			requestAnimationFrame(() => {
				if (generation !== animationGeneration.current) return;
				setOutgoingOffset(exitOffset); // Animate outgoing card off-screen

				requestAnimationFrame(() => {
					if (generation !== animationGeneration.current) return;
					setIsPositioning(false);
					setIncomingOffset(0); // Animate incoming card to center
					setSwipeOffset(0);
				});
			});

			// Clean up outgoing card after animation
			setTimeout(() => {
				if (generation !== animationGeneration.current) return;
				transitionActive.current = false;
				setOutgoingCard(null);
				setOutgoingOffset(0);
			}, transitionTime + 50);
		},
		[card, onNavigate, screenWidth],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			} else if (
				e.key === "ArrowLeft" &&
				cards.length > 0 &&
				onNavigate &&
				!isTransitioning
			) {
				const prevIndex =
					currentIndex > 0 ? currentIndex - 1 : cards.length - 1;
				triggerTransition("left", prevIndex);
			} else if (
				e.key === "ArrowRight" &&
				cards.length > 0 &&
				onNavigate &&
				!isTransitioning
			) {
				const nextIndex =
					currentIndex < cards.length - 1 ? currentIndex + 1 : 0;
				triggerTransition("right", nextIndex);
			}
		};

		if (isOpen) {
			document.addEventListener("keydown", handleKeyDown);
			document.body.style.overflow = "hidden";
		}

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = "unset";
		};
	}, [
		isOpen,
		onClose,
		cards,
		currentIndex,
		onNavigate,
		isTransitioning,
		triggerTransition,
	]);

	// Handle touch start
	const onTouchStart = (e: React.TouchEvent) => {
		if (transitionActive.current) return;
		const touch = e.touches[0];
		++animationGeneration.current;
		gestureRef.current = {
			x: touch.clientX,
			y: touch.clientY,
			offset: 0,
			started: Date.now(),
		};
		setIsPositioning(false);
		setSwipeOffset(0);
		setIsSwiping(true);
	};

	// Handle touch move - card follows finger
	const onTouchMove = (e: React.TouchEvent) => {
		const touchStart = gestureRef.current;
		if (!touchStart || transitionActive.current) return;
		const touch = e.touches[0];
		const deltaX = touch.clientX - touchStart.x;
		const deltaY = touch.clientY - touchStart.y;

		// If vertical movement dominates, don't swipe horizontally
		if (
			Math.abs(deltaY) > Math.abs(deltaX) &&
			Math.abs(touchStart.offset) < 10
		) {
			return;
		}

		touchStart.offset = deltaX;
		setSwipeOffset(deltaX);
	};

	// Handle touch end - snap or spring back
	const onTouchEnd = () => {
		const touchStart = gestureRef.current;
		gestureRef.current = null;
		if (
			!touchStart ||
			!canNavigate ||
			!onNavigate ||
			transitionActive.current
		) {
			setIsSwiping(false);
			setSwipeOffset(0);
			return;
		}

		const swipeOffset = touchStart.offset;
		const elapsed = Date.now() - touchStart.started;
		const velocity = Math.abs(swipeOffset) / elapsed;
		const isLeftSwipe =
			swipeOffset < -minSwipeDistance ||
			(swipeOffset < -20 && velocity > velocityThreshold);
		const isRightSwipe =
			swipeOffset > minSwipeDistance ||
			(swipeOffset > 20 && velocity > velocityThreshold);

		setIsSwiping(false);

		if (isLeftSwipe) {
			const nextIndex = currentIndex < cards.length - 1 ? currentIndex + 1 : 0;
			triggerTransition("right", nextIndex, swipeOffset);
		} else if (isRightSwipe) {
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : cards.length - 1;
			triggerTransition("left", prevIndex, swipeOffset);
		} else {
			// Spring back to center
			setSwipeOffset(0);
		}
	};
	const onTouchCancel = () => {
		if (!gestureRef.current) return;
		gestureRef.current = null;
		setIsSwiping(false);
		setSwipeOffset(0);
	};

	if (!isOpen || !card) return null;

	const handlePrevious = () => {
		if (canNavigate && !isTransitioning) {
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : cards.length - 1;
			triggerTransition("left", prevIndex);
		}
	};

	const handleNext = () => {
		if (canNavigate && !isTransitioning) {
			const nextIndex = currentIndex < cards.length - 1 ? currentIndex + 1 : 0;
			triggerTransition("right", nextIndex);
		}
	};

	const cardName = formatCardName(card.imageId);
	const outgoingCardName = outgoingCard
		? formatCardName(outgoingCard.imageId)
		: "";

	// Calculate current card offset (incoming during transition, or swipe during drag)
	const currentCardOffset = isTransitioning ? incomingOffset : swipeOffset;
	const currentCardRotation = (currentCardOffset / screenWidth) * 8;

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center">
			{/* Backdrop */}
			<div className="absolute inset-0 bg-black bg-opacity-90 backdrop-blur-sm transition-opacity" />

			{/* Close button */}
			<button
				onClick={onClose}
				className="absolute top-4 right-4 p-3 text-white hover:text-gray-300 hover:bg-white hover:bg-opacity-10 rounded-full transition-colors z-10"
				type="button"
				title="Close"
				aria-label="Close lightbox"
			>
				<svg
					className="w-8 h-8"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<title>Close</title>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>

			{/* Navigation Arrows */}
			{canNavigate && (
				<>
					{/* Left Arrow */}
					<button
						onClick={handlePrevious}
						className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white hover:text-gray-300 hover:bg-white hover:bg-opacity-10 rounded-full transition-colors z-10"
						type="button"
						title="Previous card"
						aria-label="Previous card"
					>
						<svg
							className="w-8 h-8"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<title>Previous</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M15 19l-7-7 7-7"
							/>
						</svg>
					</button>

					{/* Right Arrow */}
					<button
						onClick={handleNext}
						className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white hover:text-gray-300 hover:bg-white hover:bg-opacity-10 rounded-full transition-colors z-10"
						type="button"
						title="Next card"
						aria-label="Next card"
					>
						<svg
							className="w-8 h-8"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<title>Next</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</button>
				</>
			)}

			{/* Card Display */}
			{/** biome-ignore lint/a11y/useSemanticElements: Non-critical */}
			<div
				ref={cardContainerRef}
				className="relative w-full h-full flex items-center justify-center p-2"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.stopPropagation();
					}
				}}
				onTouchStart={onTouchStart}
				onTouchMove={onTouchMove}
				onTouchEnd={onTouchEnd}
				onTouchCancel={onTouchCancel}
				role="region"
				aria-label="Card display"
			>
				{/* Outgoing card (animating out) */}
				{outgoingCard && (
					<div
						className="absolute flex items-center justify-center w-full max-w-[95vmin] max-h-[95vmin] rounded-3xl overflow-hidden shadow-2xl"
						style={{
							aspectRatio: "1/1",
							transform: `translateX(${outgoingOffset}px) rotate(${outgoingRotation}deg)`,
							transition: `transform ${transitionTime}ms ease-out`,
							zIndex: 1,
						}}
					>
						<CardContent
							card={outgoingCard}
							cardName={outgoingCardName}
							speak={speak}
							isAvailable={isAvailable}
						/>
					</div>
				)}

				{/* Current card (incoming during transition, or draggable) */}
				<div
					className="absolute flex items-center justify-center w-full max-w-[95vmin] max-h-[95vmin] rounded-3xl overflow-hidden shadow-2xl"
					style={{
						aspectRatio: "1/1",
						transform: `translateX(${currentCardOffset}px) rotate(${currentCardRotation}deg)`,
						transition: disableTransition
							? "none"
							: `transform ${transitionTime}ms ease-out`,
						willChange: disableTransition ? "transform" : "auto",
						zIndex: 2,
					}}
				>
					<CardContent
						card={card}
						cardName={cardName}
						speak={speak}
						isAvailable={isAvailable}
					/>
				</div>
			</div>
		</div>
	);
};
