import type { GameTheme } from "../types";

export const GAME_THEMES: GameTheme[] = [
	// Kid-Friendly Themes
	{
		id: "dinosaur-adventure",
		name: "Dinosaur Adventure",
		description: "Travel back in time to the age of dinosaurs",
		category: "kids",
		cardPack: "dinos",
		background: "prehistoric-jungle",
		cardBack: "image",
		previewEmoji: "🦕",
	},
	{
		id: "summer-fun",
		name: "Summer Fun",
		description: "Summer cards with a beach campsite at sunset",
		category: "kids",
		cardPack: "summer-fun",
		background: "summer-fun",
		cardBack: "image",
		previewEmoji: "☀️",
	},

	// Holiday Themes
	{
		id: "christmas-magic",
		name: "Christmas Magic",
		description:
			"Celebrate the holidays with festive cards and a winter wonderland",
		category: "holiday",
		cardPack: "christmas",
		background: "snowy-mountain-village",
		cardBack: "image",
		previewEmoji: "🎄",
	},
	{
		id: "thanksgiving-feast",
		name: "Thanksgiving Feast",
		description: "Autumn vibes with Thanksgiving-themed cards",
		category: "holiday",
		cardPack: "thanksgiving",
		background: "smokey-mountain-fall",
		cardBack: "default",
		previewEmoji: "🦃",
	},

	// Nature Themes
	{
		id: "ocean-explorer",
		name: "Ocean Explorer",
		description: "Dive deep into the ocean with marine life cards",
		category: "nature",
		cardPack: "ocean-real",
		background: "sun-drenched-coral-reef",
		cardBack: "blue",
		previewEmoji: "🌊",
	},
	{
		id: "jungle-safari",
		name: "Jungle Safari",
		description: "Explore the rainforest with exotic jungle animals",
		category: "nature",
		cardPack: "jungle-animals-real",
		background: "prehistoric-jungle",
		cardBack: "default",
		previewEmoji: "🦁",
	},
	{
		id: "china-discovery",
		name: "China Discovery",
		description: "Discover unique animals from China",
		category: "nature",
		cardPack: "animals-from-china-real",
		background: "galaxy",
		cardBack: "default",
		previewEmoji: "🐼",
	},

	// Kid-Friendly Themes
	{
		id: "cute-friends",
		name: "Cute Friends",
		description: "Adorable plush animals in a colorful rainbow world",
		category: "kids",
		cardPack: "plush-cute-animals-real",
		background: "rainbow",
		cardBack: "image",
		previewEmoji: "🧸",
	},
	{
		id: "bug-hunt",
		name: "Bug Hunt",
		description: "Search for insects in a forest setting",
		category: "kids",
		cardPack: "insects-real",
		background: "forest",
		cardBack: "default",
		previewEmoji: "🦋",
	},

	// Educational/Other Themes
	{
		id: "construction-zone",
		name: "Construction Zone",
		description: "Build and learn with construction vehicles",
		category: "educational",
		cardPack: "construction-real",
		background: "photo2",
		cardBack: "default",
		previewEmoji: "🚧",
	},
];

// Helper function to get themes by category
export const getThemesByCategory = (
	category: GameTheme["category"],
): GameTheme[] => {
	return GAME_THEMES.filter((theme) => theme.category === category);
};

// Helper function to get a theme by ID
export const getThemeById = (id: string): GameTheme | undefined => {
	return GAME_THEMES.find((theme) => theme.id === id);
};
