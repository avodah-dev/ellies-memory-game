import { useCallback, useState } from "react";

// Local background images from public/backgrounds/ folder
// Add new background images here - they will be automatically included
const LOCAL_BACKGROUND_FILES = [
	"snowy-mountain-village.jpg",
	"smokey-mountain-fall.jpg",
	"prehistoric-jungle.jpg",
	"sun-drenched-coral-reef.jpg",
	"deep-ocean-coral-reef.jpg",
	"summer-fun.jpg",
] as const;

// Extract background IDs from local files (remove extension)
type LocalBackgroundId =
	(typeof LOCAL_BACKGROUND_FILES)[number] extends `${infer Name}.${string}`
		? Name
		: never;

export type BackgroundTheme =
	| "rainbow"
	| "ocean"
	| "sunset"
	| "forest"
	| "galaxy"
	| "photo1"
	| "photo2"
	| "photo3"
	| "photo4"
	| LocalBackgroundId;

export interface BackgroundOption {
	id: BackgroundTheme;
	name: string;
	gradient?: string;
	imageUrl?: string;
	blurAmount?: number; // Optional blur override in pixels (default: 2, use 0 to disable)
}

// Helper function to convert filename to display name
// e.g., "snowy-mountain-village.jpg" -> "Snowy Mountain Village"
const filenameToDisplayName = (filename: string): string => {
	return filename
		.replace(/\.(jpg|jpeg|png|gif|webp)$/i, "")
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
};

// Per-background blur overrides (filename -> blur amount in pixels)
const BLUR_OVERRIDES: Record<string, number> = {
	"deep-ocean-coral-reef.jpg": 3,
};

// Generate background options from local files
const generateLocalBackgroundOptions = (): BackgroundOption[] => {
	return LOCAL_BACKGROUND_FILES.map((filename) => {
		const id = filename.replace(
			/\.(jpg|jpeg|png|gif|webp)$/i,
			"",
		) as BackgroundTheme;
		const name = filenameToDisplayName(filename);
		const imageUrl = `/backgrounds/${filename}`;
		const blurAmount = BLUR_OVERRIDES[filename];
		return {
			id,
			name,
			imageUrl,
			...(blurAmount !== undefined && { blurAmount }),
		};
	});
};

export const BACKGROUND_OPTIONS: BackgroundOption[] = [
	{
		id: "rainbow",
		name: "Rainbow",
		gradient: "from-pink-300 via-purple-300 to-indigo-400",
	},
	{
		id: "ocean",
		name: "Ocean",
		gradient: "from-blue-200 via-cyan-200 to-teal-300",
	},
	{
		id: "sunset",
		name: "Sunset",
		gradient: "from-orange-300 via-red-300 to-pink-400",
	},
	{
		id: "forest",
		name: "Forest",
		gradient: "from-green-200 via-emerald-300 to-teal-400",
	},
	{
		id: "galaxy",
		name: "Galaxy",
		imageUrl:
			"https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&q=80&w=3270",
	},
	{
		id: "photo1",
		name: "El Senor Crabby Face",
		imageUrl:
			"https://images.unsplash.com/photo-1642703746482-a8393214657d?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&q=80&w=3132",
	},
	{
		id: "photo2",
		name: "Under Construction",
		imageUrl:
			"https://images.unsplash.com/photo-1669717390649-7ce9a964a21c?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&q=80&w=2069",
	},
	{
		id: "photo3",
		name: "Wooden Boxcar",
		imageUrl:
			"https://images.unsplash.com/photo-1719678275096-70b51a7bc915?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&q=80&w=2070",
	},
	{
		id: "photo4",
		name: "Mountains in Fall",
		imageUrl:
			"https://images.unsplash.com/photo-1631941461005-a915d514ef03?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&q=80&w=2070",
	},
	// Local backgrounds from public/backgrounds/ folder
	...generateLocalBackgroundOptions(),
];

export const useBackgroundSelector = () => {
	const [selectedBackground, setSelectedBackground] = useState<BackgroundTheme>(
		() => {
			const saved = localStorage.getItem("background");
			return (saved as BackgroundTheme) || "rainbow";
		},
	);

	const getCurrentBackground = () => {
		const option = BACKGROUND_OPTIONS.find(
			(bg) => bg.id === selectedBackground,
		);
		return option || BACKGROUND_OPTIONS[0];
	};

	const setSelectedBackgroundWithStorage = useCallback(
		(background: BackgroundTheme) => {
			setSelectedBackground(background);
			localStorage.setItem("background", background);
		},
		[],
	);

	return {
		selectedBackground,
		setSelectedBackground: setSelectedBackgroundWithStorage,
		getCurrentBackground,
		backgroundOptions: BACKGROUND_OPTIONS,
	};
};
