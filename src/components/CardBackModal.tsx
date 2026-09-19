import { debugLog } from "../utils/debugLog";
import { CARD_BACK_OPTIONS } from "../hooks/useCardBackSelector";

const ENABLE_SETUP_DEBUG_LOGS = true;

const logWizardInteraction = (...args: unknown[]) => {
	if (!ENABLE_SETUP_DEBUG_LOGS) return;
	debugLog("[Setup Wizard Interaction]", ...args);
};

interface CardBackModalProps {
	selectedCardBack: string;
	onSelect: (cardBackId: string) => void;
	onClose: () => void;
	onBack?: () => void;
	isResetting?: boolean;
}

export const CardBackModal = ({
	selectedCardBack,
	onSelect,
}: CardBackModalProps) => {
	const handleSelect = (e: React.MouseEvent, cardBackId: string) => {
		e.stopPropagation(); // Prevent event bubbling
		logWizardInteraction("Card back selected", {
			cardBackId,
			currentCardBack: selectedCardBack,
		});
		onSelect(cardBackId);
		// Don't call onClose here - let the parent handle navigation
	};

	return (
		<div className="space-y-6">
			{/* Card Back Options */}
			<div className="grid grid-cols-1 gap-4">
				{CARD_BACK_OPTIONS.map((option) => (
					<button
						type="button"
						key={option.id}
						onClick={(e) => handleSelect(e, option.id)}
						className={`p-6 rounded-xl border-3 transition-all duration-200 transform can-hover:scale-[1.02] ${
							selectedCardBack === option.id
								? "border-purple-500 bg-purple-50 shadow-lg"
								: "border-gray-200 bg-white can-hover:border-gray-300 can-hover:shadow-md"
						}`}
					>
						<div className="flex items-center gap-6">
							{/* Preview Section */}
							<div className="flex-shrink-0">
								<div
									className={`w-24 h-24 rounded-lg shadow-inner overflow-hidden flex items-center justify-center border-2 ${
										option.gradient
											? `bg-gradient-to-br ${option.gradient}`
											: ""
									} ${option.id === "default" ? "border-indigo-300" : option.id === "emoji" ? "border-purple-300" : option.id === "blue" ? "border-blue-300" : "border-gray-300"}`}
									style={
										option.imageUrl
											? {
													backgroundImage: `url(${option.imageUrl})`,
													backgroundSize: "cover",
													backgroundPosition: "center",
												}
											: option.radialGradient
												? {
														background: option.radialGradient,
													}
												: option.solidColor
													? {
															backgroundColor: option.solidColor,
														}
													: {}
									}
								>
									{option.emoji && (
										<div className="text-white font-bold text-4xl">
											{option.emoji}
										</div>
									)}
								</div>
							</div>

							{/* Info Section */}
							<div className="flex-1 text-left">
								<div className="text-xl font-bold text-gray-800 mb-2">
									{option.name}
								</div>
								<div className="text-sm text-gray-600 mb-3">
									{option.id === "default" &&
										"💜 Classic purple gradient with question mark"}
									{option.id === "emoji" &&
										"❓ Emoji question mark on purple background"}
									{option.id === "image" &&
										"🖼️ Custom image from your collection"}
									{option.id === "blue" && "💙 Plain royal blue solid color"}
								</div>
								{selectedCardBack === option.id && (
									<div className="text-sm font-semibold text-purple-600">
										✓ Currently Selected
									</div>
								)}
							</div>
						</div>
					</button>
				))}
			</div>
		</div>
	);
};
