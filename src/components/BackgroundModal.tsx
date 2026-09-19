import { debugLog } from "../utils/debugLog";
import { useState } from "react";
import { BACKGROUND_OPTIONS } from "../hooks/useBackgroundSelector";

const ENABLE_SETUP_DEBUG_LOGS = true;

const logWizardInteraction = (...args: unknown[]) => {
	if (!ENABLE_SETUP_DEBUG_LOGS) return;
	debugLog("[Setup Wizard Interaction]", ...args);
};

interface BackgroundModalProps {
	selectedBackground: string;
	onSelect: (backgroundId: string) => void;
	onClose: () => void;
	onBack?: () => void;
	isResetting?: boolean;
}

export const BackgroundModal = ({
	selectedBackground,
	onSelect,
}: BackgroundModalProps) => {
	const [activeTab, setActiveTab] = useState<"colors" | "pictures">("pictures");

	const handleSelect = (e: React.MouseEvent, backgroundId: string) => {
		e.stopPropagation(); // Prevent event bubbling
		logWizardInteraction("Background selected", {
			backgroundId,
			currentBackground: selectedBackground,
		});
		onSelect(backgroundId);
		// Don't call onClose here - let the parent handle navigation
	};

	const colorOptions = BACKGROUND_OPTIONS.filter((option) => option.gradient);
	const pictureOptions = BACKGROUND_OPTIONS.filter((option) => option.imageUrl);

	return (
		<div className="space-y-6">
			{/* Tabs */}
			<div className="flex gap-2 border-b border-gray-200">
				<button
					type="button"
					onClick={() => setActiveTab("pictures")}
					className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
						activeTab === "pictures"
							? "border-purple-500 text-purple-600"
							: "border-transparent text-gray-500 hover:text-gray-700"
					}`}
				>
					Pictures
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("colors")}
					className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
						activeTab === "colors"
							? "border-purple-500 text-purple-600"
							: "border-transparent text-gray-500 hover:text-gray-700"
					}`}
				>
					Colors
				</button>
			</div>

			{/* Background Options */}
			<div className="grid grid-cols-1 gap-4">
				{(activeTab === "colors" ? colorOptions : pictureOptions).map(
					(option) => (
						<button
							type="button"
							key={option.id}
							onClick={(e) => handleSelect(e, option.id)}
							className={`p-6 rounded-xl border-3 transition-all duration-200 transform can-hover:scale-[1.02] ${
								selectedBackground === option.id
									? "border-purple-500 bg-purple-50 shadow-lg"
									: "border-gray-200 bg-white can-hover:border-gray-300 can-hover:shadow-md"
							}`}
						>
							<div className="flex items-center gap-6">
								{/* Preview Section */}
								<div className="flex-shrink-0">
									{option.imageUrl ? (
										<div
											className="w-24 h-24 rounded-lg shadow-inner overflow-hidden"
											style={{
												backgroundImage: `url(${option.imageUrl})`,
												backgroundSize: "cover",
												backgroundPosition: "center",
											}}
										/>
									) : (
										<div
											className={`w-24 h-24 rounded-lg bg-gradient-to-br ${option.gradient} shadow-inner`}
										/>
									)}
								</div>

								{/* Info Section */}
								<div className="flex-1 text-left">
									<div className="text-xl font-bold text-gray-800 mb-2">
										{option.name}
									</div>
									<div className="text-sm text-gray-600 mb-3">
										{option.id === "rainbow" &&
											"🌈 Colorful and fun with pink, purple, and indigo"}
										{option.id === "ocean" &&
											"🌊 Calm and refreshing with blue and cyan tones"}
										{option.id === "sunset" &&
											"🌅 Warm and cozy with orange and red colors"}
										{option.id === "forest" &&
											"🌲 Natural and peaceful with green shades"}
										{option.id === "galaxy" &&
											"🌌 Mysterious and exciting with purple and pink"}
										{option.id === "photo1" &&
											"🎨 Beautiful abstract art picture"}
										{option.id === "photo2" && "🚧 Construction site picture"}
										{option.id === "photo3" && "🚂 Wooden boxcar picture"}
										{option.id === "photo4" &&
											"🏔️ Beautiful mountain landscape in autumn"}
									</div>
									{selectedBackground === option.id && (
										<div className="text-sm font-semibold text-purple-600">
											✓ Currently Selected
										</div>
									)}
								</div>
							</div>
						</button>
					),
				)}
			</div>
		</div>
	);
};
