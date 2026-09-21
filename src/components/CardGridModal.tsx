import { type ReactNode, useState } from "react";
import type { Card } from "../types";
import { CardThumbnail } from "./CardThumbnail";
import { CardLightbox } from "./CardLightbox";

// Fixed card size for modal display - independent of game board card size
export const MODAL_CARD_SIZE = 180; // Increased by 20% from 120

interface CardGridModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: ReactNode; // Allow ReactNode for flexible header (e.g., editable player name)
	subtitle?: string; // Optional subtitle (e.g., card count, pair count)
	cards: Card[]; // Cards to display in the grid
	useWhiteCardBackground?: boolean;
	emojiSizePercentage?: number;
	emptyMessage?: string; // Customizable empty state message
	renderCard?: (
		card: Card,
		index: number,
		onCardClick: (index: number) => void,
	) => ReactNode; // Optional custom card renderer
}

export const CardGridModal = ({
	isOpen,
	onClose,
	title,
	subtitle,
	cards,
	useWhiteCardBackground = false,
	emojiSizePercentage = 72,
	emptyMessage = "No cards available!",
	renderCard,
}: CardGridModalProps) => {
	const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(
		null,
	);

	if (!isOpen) return null;

	const handleCardClick = (index: number) => {
		setSelectedCardIndex(index);
	};

	const handleCloseLightbox = () => {
		setSelectedCardIndex(null);
	};

	const handleNavigate = (index: number) => {
		setSelectedCardIndex(index);
	};

	// Default card renderer
	const defaultRenderCard = (
		card: Card,
		index: number,
		onCardClick: (index: number) => void,
	) => (
		<div key={card.id} className="flex flex-col items-center gap-2">
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onCardClick(index);
				}}
				className="cursor-pointer transition-transform can-hover:scale-110 active:scale-95 border-0 bg-transparent p-0"
				aria-label={`View ${card.imageId.replaceAll("-", " ")}`}
				title="Click to view card details"
			>
				<CardThumbnail
					card={card}
					size={MODAL_CARD_SIZE}
					useWhiteBackground={useWhiteCardBackground}
					emojiSizePercentage={emojiSizePercentage}
				/>
			</button>
		</div>
	);

	const cardRenderer = renderCard || defaultRenderCard;

	return (
		<>
			<div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8">
				{/* Backdrop */}
				<div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm" />

				{/* Modal */}
				<div
					className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.stopPropagation();
						}
					}}
					role="dialog"
					aria-modal="true"
				>
					{/* Header */}
					<div className="flex items-center justify-between p-6 border-b border-gray-200">
						<div>
							<div className="flex items-center gap-2">
								{typeof title === "string" ? (
									<h2 className="text-2xl font-bold text-gray-800">{title}</h2>
								) : (
									title
								)}
							</div>
							{subtitle && (
								<p className="text-sm text-gray-500 mt-1">{subtitle}</p>
							)}
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								onClose();
							}}
							className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors z-10"
							type="button"
							title="Close"
							aria-label="Close modal"
						>
							<svg
								className="w-6 h-6"
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
					</div>

					{/* Content */}
					<div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)] touch-pan-y">
						{cards.length === 0 ? (
							<div className="text-center py-12">
								<p className="text-gray-500 text-lg">{emptyMessage}</p>
							</div>
						) : (
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
								{cards.map((card, index) =>
									cardRenderer(card, index, handleCardClick),
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Card Lightbox */}
			<CardLightbox
				isOpen={selectedCardIndex !== null}
				onClose={handleCloseLightbox}
				card={selectedCardIndex !== null ? cards[selectedCardIndex] : null}
				cards={cards}
				currentIndex={selectedCardIndex ?? 0}
				onNavigate={handleNavigate}
			/>
		</>
	);
};
