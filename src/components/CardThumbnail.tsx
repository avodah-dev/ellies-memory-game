import type { Card } from "../types";

interface CardThumbnailProps {
	card: Pick<Card, "imageId" | "imageUrl" | "gradient">;
	size: number;
	useWhiteBackground: boolean;
	emojiSizePercentage: number;
}

// Modal artwork is presentational. Its containing button owns preview activation;
// matched status, gameplay input handlers and flip animations do not belong here.
export function CardThumbnail({
	card,
	size,
	useWhiteBackground,
	emojiSizePercentage,
}: CardThumbnailProps) {
	const isImage =
		card.imageUrl &&
		(card.imageUrl.startsWith("http") ||
			card.imageUrl.startsWith("/") ||
			card.imageUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
			card.imageUrl.includes("blob:") ||
			card.imageUrl.includes("data:"));
	return (
		<span
			aria-hidden="true"
			className={`relative block rounded-lg shadow-lg overflow-hidden ${
				useWhiteBackground
					? "bg-white"
					: `bg-gradient-to-br ${card.gradient || "from-gray-400 to-gray-600"}`
			}`}
			style={{ width: size, height: size }}
		>
			{!useWhiteBackground && (
				<span className="absolute inset-0 bg-white opacity-30" />
			)}
			<span
				className="relative w-full h-full flex items-center justify-center"
				style={{ fontSize: Math.round((size * emojiSizePercentage) / 100) }}
			>
				{isImage ? (
					<img src={card.imageUrl} alt="" className="w-full h-full object-cover" />
				) : (
					card.imageUrl
				)}
			</span>
		</span>
	);
}
