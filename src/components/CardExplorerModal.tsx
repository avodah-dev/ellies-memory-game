import type { Card } from "../types";
import { CardGridModal } from "./CardGridModal";

interface CardExplorerModalProps {
	isOpen: boolean;
	onClose: () => void;
	cards: Card[];
	useWhiteCardBackground?: boolean;
	emojiSizePercentage?: number;
}

export const CardExplorerModal = ({
	isOpen,
	onClose,
	cards,
	useWhiteCardBackground = false,
	emojiSizePercentage = 72,
}: CardExplorerModalProps) => {
	// Get unique cards (one per imageId) and ensure they're flipped to show faces
	const uniqueCardsMap = new Map<string, Card>();
	cards.forEach((card) => {
		if (!uniqueCardsMap.has(card.imageId)) {
			uniqueCardsMap.set(card.imageId, {
				...card,
				isFlipped: true, // Show card faces in explorer
			});
		}
	});
	const uniqueCards = Array.from(uniqueCardsMap.values());

	return (
		<CardGridModal
			isOpen={isOpen}
			onClose={onClose}
			title="Explore All Cards"
			subtitle={`${uniqueCards.length} card${uniqueCards.length !== 1 ? "s" : ""} in deck`}
			cards={uniqueCards}
			useWhiteCardBackground={useWhiteCardBackground}
			emojiSizePercentage={emojiSizePercentage}
			emptyMessage="No cards available!"
		/>
	);
};
