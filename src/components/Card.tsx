import type { CardBackOption } from "../hooks/useCardBackSelector";
import type { Card as CardType } from "../types";

interface CardProps {
	card: CardType;
	onClick: () => void;
	size?: number;
	useWhiteBackground?: boolean;
	emojiSizePercentage?: number;
	cardBack?: CardBackOption;
	forceGameplaySize?: boolean; // Force use of regular gameplay size instead of matched size
	forceGameplayBackground?: boolean; // Force use of gradient background instead of white matched background
}

export const Card = ({
	card,
	onClick,
	size = 100,
	useWhiteBackground = false,
	emojiSizePercentage = 72,
	cardBack,
	forceGameplaySize = false,
	forceGameplayBackground = false,
}: CardProps) => {
	// Calculate font size based on card size and emoji size percentage
	// emojiSizePercentage is a percentage (e.g., 72 means 72% of card size)
	const fontSize = Math.round((size * emojiSizePercentage) / 100);
	// For matched cards, make emoji 50% bigger (1.5x the normal size)
	const matchedFontSize = Math.round(
		((size * emojiSizePercentage) / 100) * 1.5,
	);

	// Default card back if none provided
	const defaultCardBack: CardBackOption = {
		id: "default",
		name: "Default",
		gradient: "from-indigo-500 to-purple-600",
		emoji: "?",
	};

	const activeCardBack = cardBack || defaultCardBack;

	return (
		<button
			type="button"
			aria-label={
				card.isFlipped || card.isMatched
					? card.imageId.replaceAll("-", " ")
					: `Face-down card ${card.id}`
			}
			aria-pressed={card.isFlipped}
			disabled={card.isMatched}
			data-card-id={card.id}
			data-allow-touchmove
			onClick={onClick}
			className={`relative transition-transform duration-500 transform-gpu ${card.isMatched ? "cursor-default" : "cursor-pointer"}`}
			style={{
				width: `${size}px`,
				height: `${size}px`,
				transformStyle: "preserve-3d",
				transform:
					card.isFlipped || card.isMatched
						? "rotateY(180deg)"
						: "rotateY(0deg)",
				pointerEvents: "auto",
				userSelect: "none", // Prevent text selection for snappier feel
				touchAction: "manipulation", // Optimize touch interactions on mobile
			}}
		>
			{/* Card Back */}
			<div
				className={`absolute inset-0 w-full h-full rounded-lg shadow-lg flex items-center justify-center border-2 ${
					activeCardBack.gradient
						? `bg-gradient-to-br ${activeCardBack.gradient}`
						: ""
				} ${activeCardBack.id === "default" ? "border-indigo-300" : activeCardBack.id === "emoji" ? "border-purple-300" : activeCardBack.id === "blue" ? "border-blue-300" : "border-gray-300"}`}
				style={{
					backfaceVisibility: "hidden",
					transform: "rotateY(0deg)",
					...(activeCardBack.imageUrl
						? {
								backgroundImage: `url(${activeCardBack.imageUrl})`,
								backgroundSize: "cover",
								backgroundPosition: "center",
							}
						: activeCardBack.radialGradient
							? {
									background: activeCardBack.radialGradient,
								}
							: activeCardBack.solidColor
								? {
										backgroundColor: activeCardBack.solidColor,
									}
								: {}),
				}}
			>
				{activeCardBack.emoji && (
					<div
						className="text-white font-bold"
						style={{ fontSize: `${fontSize}px` }}
					>
						{activeCardBack.emoji}
					</div>
				)}
				{activeCardBack.id === "default" && !activeCardBack.emoji && (
					<div
						className="text-white font-bold"
						style={{ fontSize: `${fontSize}px` }}
					>
						?
					</div>
				)}
			</div>

			{/* Card Front */}
			<div
				className={`absolute inset-0 w-full h-full rounded-lg shadow-lg overflow-hidden ${
					useWhiteBackground || (card.isMatched && !forceGameplayBackground)
						? "bg-white"
						: `bg-gradient-to-br ${card.gradient || "from-gray-400 to-gray-600"}`
				}`}
				style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
			>
				{/* Semi-transparent white overlay to reduce background visibility (30% less visible = 70% opacity) */}
				{!(
					useWhiteBackground ||
					(card.isMatched && !forceGameplayBackground)
				) && (
					<div
						className="absolute inset-0 bg-white opacity-30"
						style={{ backfaceVisibility: "hidden" }}
					/>
				)}
				<div
					className="relative w-full h-full flex items-center justify-center"
					style={{
						fontSize: forceGameplaySize
							? `${fontSize}px`
							: card.isMatched
								? `${matchedFontSize}px`
								: `${fontSize}px`,
					}}
				>
					{card.imageUrl &&
					(card.imageUrl.startsWith("http") ||
						card.imageUrl.startsWith("/") ||
						card.imageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
						card.imageUrl.includes("blob:") ||
						card.imageUrl.includes("data:")) ? (
						<img
							src={card.imageUrl}
							alt=""
							className="w-full h-full object-cover"
							style={{ backfaceVisibility: "hidden" }}
						/>
					) : (
						card.imageUrl
					)}
				</div>
			</div>
		</button>
	);
};
