import { debugLog } from "../utils/debugLog";
import { useState } from "react";
import { CARD_DECKS } from "../data/cardDecks";
import type { Card, CardPackOption } from "../types";
import { CardExplorerModal } from "./CardExplorerModal";

const ENABLE_SETUP_DEBUG_LOGS = true;

const logWizardInteraction = (...args: unknown[]) => {
	if (!ENABLE_SETUP_DEBUG_LOGS) return;
	debugLog("[Setup Wizard Interaction]", ...args);
};

interface CardPackModalProps {
	cardPacks: CardPackOption[];
	selectedPack: string;
	onSelect: (packId: string) => void;
	onClose: () => void;
}

export const CardPackModal = ({
	cardPacks,
	selectedPack,
	onSelect,
}: CardPackModalProps) => {
	// Determine initial tab based on selected pack (default to pictures to highlight images)
	const getInitialTab = () => {
		const emojiPackIds = [
			"animals",
			"plants",
			"buildings",
			"colors",
			"ocean",
			"construction",
		];
		return emojiPackIds.includes(selectedPack) ? "emoji" : "pictures";
	};

	const [activeTab, setActiveTab] = useState<"emoji" | "pictures">(
		getInitialTab(),
	);
	const [previewPackId, setPreviewPackId] = useState<string | null>(null);

	const handleSelect = (packId: string) => {
		logWizardInteraction("Card pack selected", { packId, selectedPack });
		onSelect(packId);
		// Don't call onClose here - let the parent handle navigation
	};

	// Separate emoji and picture packs
	const emojiPacks = cardPacks.filter((pack) =>
		[
			"animals",
			"plants",
			"buildings",
			"colors",
			"ocean",
			"construction",
		].includes(pack.id),
	);
	const picturePacks = cardPacks.filter((pack) =>
		[
			"animals-real",
			"ocean-real",
			"emotions-real",
			"insects-real",
			"jungle-animals-real",
			"plush-cute-animals-real",
			"construction-real",
			"animals-from-china-real",
			"thanksgiving",
			"christmas",
			"dinos",
			"hotwheels",
			"summer-fun",
		].includes(pack.id),
	);

	// Get preview images for animals-real deck
	const getAnimalsRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "animals-real");
		if (!deck) return [];
		// Pick 4 images for preview: lion, elephant, cat, dog
		const previewIds = ["lion", "elephant", "cat", "dog"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for ocean-real deck
	const getOceanRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "ocean-real");
		if (!deck) return [];
		// Pick 4 images for preview: fish, whale, dolphin, octopus
		const previewIds = ["fish", "whale", "dolphin", "octopus"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for emotions-real deck
	const getEmotionsRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "emotions-real");
		if (!deck) return [];
		// Pick 4 images for preview: happy, sad, angry, excited
		const previewIds = ["happy", "sad", "angry", "excited"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for insects-real deck
	const getInsectsRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "insects-real");
		if (!deck) return [];
		// Pick 4 images for preview: ladybug, honeybee, butterfly, dragonfly
		const previewIds = [
			"ladybug",
			"honeybee",
			"monarch-butterfly",
			"dragonfly",
		];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for jungle-animals-real deck
	const getJungleAnimalsRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "jungle-animals-real");
		if (!deck) return [];
		// Pick 4 images for preview: jaguar, toucan, sloth, macaw
		const previewIds = ["jaguar", "toucan", "sloth", "macaw"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for plush-cute-animals-real deck
	const getPlushCuteAnimalsRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "plush-cute-animals-real");
		if (!deck) return [];
		// Pick 4 images for preview: bunny, kitten, puppy, panda
		const previewIds = ["bunny", "kitten", "puppy", "panda"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for construction-real deck
	const getConstructionRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "construction-real");
		if (!deck) return [];
		// Pick 4 images for preview: bulldozer, excavator, tower-crane, hard-hat
		const previewIds = ["bulldozer", "excavator", "tower-crane", "hard-hat"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for animals-from-china-real deck
	const getAnimalsFromChinaRealPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "animals-from-china-real");
		if (!deck) return [];
		// Pick 4 images for preview: giant-panda, red-panda, siberian-tiger, snow-leopard
		const previewIds = [
			"giant-panda",
			"red-panda",
			"siberian-tiger",
			"snow-leopard",
		];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for thanksgiving deck
	const getThanksgivingPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "thanksgiving");
		if (!deck) return [];
		// Pick 4 images for preview: live-turkey, pumpkin, cornucopia, maple-leaf
		const previewIds = ["live-turkey", "pumpkin", "cornucopia", "maple-leaf"];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for christmas deck
	const getChristmasPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "christmas");
		if (!deck) return [];
		// Pick 4 images for preview: christmas-tree, santa-claus, reindeer, present-gift-box
		const previewIds = [
			"christmas-tree",
			"santa-claus",
			"reindeer",
			"present-gift-box",
		];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	// Get preview images for dinos deck
	const getDinosPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "dinos");
		if (!deck) return [];
		// First 4 cards for preview
		return deck.cards.slice(0, 4);
	};

	// Get preview images for hotwheels deck
	const getHotwheelsPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "hotwheels");
		if (!deck) return [];
		// First 4 cards for preview
		return deck.cards.slice(0, 4);
	};

	// Get preview images for summer-fun deck
	const getSummerFunPreview = () => {
		const deck = CARD_DECKS.find((d) => d.id === "summer-fun");
		if (!deck) return [];
		const previewIds = [
			"beach-ball",
			"ice-cream-cone",
			"sandcastle",
			"watermelon-slice",
		];
		return deck.cards
			.filter((card) => previewIds.includes(card.id))
			.slice(0, 4);
	};

	const animalsRealPreview = getAnimalsRealPreview();
	const oceanRealPreview = getOceanRealPreview();
	const emotionsRealPreview = getEmotionsRealPreview();
	const insectsRealPreview = getInsectsRealPreview();
	const jungleAnimalsRealPreview = getJungleAnimalsRealPreview();
	const plushCuteAnimalsRealPreview = getPlushCuteAnimalsRealPreview();
	const constructionRealPreview = getConstructionRealPreview();
	const animalsFromChinaRealPreview = getAnimalsFromChinaRealPreview();
	const thanksgivingPreview = getThanksgivingPreview();
	const christmasPreview = getChristmasPreview();
	const dinosPreview = getDinosPreview();
	const hotwheelsPreview = getHotwheelsPreview();
	const summerFunPreview = getSummerFunPreview();

	// Determine which packs to show based on active tab
	const displayedPacks = activeTab === "emoji" ? emojiPacks : picturePacks;

	// Helper function to convert deck cards to Card[] format for CardExplorerModal
	const getCardsForPack = (packId: string): Card[] => {
		const deck = CARD_DECKS.find((d) => d.id === packId);
		if (!deck) return [];

		return deck.cards.map((cardData, index) => ({
			id: `preview-card-${index}`,
			imageId: cardData.id,
			imageUrl: cardData.imageUrl || cardData.emoji,
			gradient: cardData.gradient,
			isFlipped: false,
			isMatched: false,
		}));
	};

	const handlePreviewClick = (e: React.MouseEvent, packId: string) => {
		e.stopPropagation(); // Prevent pack selection
		setPreviewPackId(packId);
	};

	const previewCards = previewPackId ? getCardsForPack(previewPackId) : [];

	return (
		<div className="space-y-6">
			{/* Tabs */}
			<div className="flex gap-2 border-b border-gray-200">
				<button
					type="button"
					onClick={() => setActiveTab("pictures")}
					className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
						activeTab === "pictures"
							? "border-blue-500 text-blue-600"
							: "border-transparent text-gray-500 hover:text-gray-700"
					}`}
				>
					Pictures
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("emoji")}
					className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
						activeTab === "emoji"
							? "border-blue-500 text-blue-600"
							: "border-transparent text-gray-500 hover:text-gray-700"
					}`}
				>
					Emoji
				</button>
			</div>

			{/* Card Pack Options */}
			<div className="grid grid-cols-2 gap-6">
				{displayedPacks.map((pack) => (
					<div
						key={pack.id}
						className={`relative p-8 rounded-xl border-3 transition-all duration-200 transform can-hover:scale-105 touch-pan-y ${
							selectedPack === pack.id
								? "border-blue-500 bg-blue-50 shadow-lg"
								: "border-gray-200 bg-white can-hover:border-gray-300 can-hover:shadow-md"
						}`}
					>
						{/* Preview Icon Button */}
						<button
							onClick={(e) => {
								e.stopPropagation();
								handlePreviewClick(e, pack.id);
							}}
							className="absolute top-2 right-2 p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors z-10"
							type="button"
							title="Preview cards"
						>
							<svg
								className="w-5 h-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<title>Preview</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
								/>
							</svg>
						</button>

						<button
							type="button"
							onClick={() => handleSelect(pack.id)}
							className="w-full"
						>
							{/* Preview Section */}
							{pack.id === "animals-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{animalsRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "ocean-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-blue-400 to-cyan-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{oceanRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "emotions-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-pink-400 to-purple-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{emotionsRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "insects-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-green-400 to-yellow-500 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{insectsRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "jungle-animals-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-green-600 to-amber-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{jungleAnimalsRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "plush-cute-animals-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-pink-300 to-purple-400 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{plushCuteAnimalsRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "construction-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-yellow-500 to-orange-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{constructionRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "animals-from-china-real" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-red-500 to-orange-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{animalsFromChinaRealPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "thanksgiving" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{thanksgivingPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "christmas" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-red-500 to-green-600 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{christmasPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "dinos" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{dinosPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "hotwheels" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{hotwheelsPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : pack.id === "summer-fun" ? (
								<div className="mb-4">
									<div className="w-full h-40 rounded-lg bg-gradient-to-br from-sky-300 to-amber-400 grid grid-cols-2 grid-rows-2 gap-1 p-1">
										{summerFunPreview.map(
											(card) =>
												card.imageUrl && (
													<div
														key={card.id}
														className="w-full h-full flex items-center justify-center bg-white bg-opacity-20 rounded overflow-hidden"
													>
														<img
															src={card.imageUrl}
															alt={card.id}
															className="max-w-full max-h-full object-contain"
														/>
													</div>
												),
										)}
									</div>
								</div>
							) : (
								<div className="mb-4">
									<div
										className={`w-full h-32 rounded-lg bg-gradient-to-br ${
											pack.id === "animals"
												? "from-amber-400 to-orange-600"
												: pack.id === "plants"
													? "from-green-400 to-green-700"
													: pack.id === "buildings"
														? "from-gray-500 to-gray-700"
														: pack.id === "ocean"
															? "from-blue-400 to-cyan-600"
															: pack.id === "colors"
																? "from-purple-400 to-purple-700"
																: pack.id === "construction"
																	? "from-gray-600 to-gray-800"
																	: "from-purple-400 to-purple-700"
										} flex items-center justify-center`}
									>
										<span className="text-6xl">{pack.emoji}</span>
									</div>
								</div>
							)}

							{/* Info Section */}
							<div className="text-center">
								<div className="text-2xl font-bold text-gray-800 mb-2">
									{pack.name}
								</div>
								<div className="text-sm text-gray-600">
									{pack.id === "animals" && "🦁🐘🐕🐈🐰🦅🐠🐼🐵🐯🐻🦊"}
									{pack.id === "plants" && "🌹🌷🌻🌳🌵🍃🌸🍄🌴🌿🌱🌲"}
									{pack.id === "buildings" && "🏠🏰🏢⛪🏭🗼🌉🔺🏥🏨🏬🏫"}
									{pack.id === "colors" && "🔴🔵🟢🟡🟣🟠💗🩵🟤⚫⚪💚"}
									{pack.id === "ocean" && "🐟🐋🐬🐙🦀🐢🪼🦈🐴🐚⭐🪸"}
								</div>
								{selectedPack === pack.id && (
									<div className="mt-3 text-sm font-semibold text-blue-600">
										✓ Currently Selected
									</div>
								)}
							</div>
						</button>
					</div>
				))}
			</div>

			{/* Card Explorer Modal for Preview */}
			<CardExplorerModal
				isOpen={previewPackId !== null}
				onClose={() => setPreviewPackId(null)}
				cards={previewCards}
				useWhiteCardBackground={false}
				emojiSizePercentage={72}
			/>
		</div>
	);
};
