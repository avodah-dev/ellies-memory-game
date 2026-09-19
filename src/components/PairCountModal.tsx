import { debugLog } from "../utils/debugLog";
import {
	calculateGridDimensions,
	PAIR_COUNT_OPTIONS,
} from "../utils/gridLayout";

const ENABLE_SETUP_DEBUG_LOGS = true;

const logWizardInteraction = (...args: unknown[]) => {
	if (!ENABLE_SETUP_DEBUG_LOGS) return;
	debugLog("[Setup Wizard Interaction]", ...args);
};

interface PairCountModalProps {
	selectedPairCount: number;
	onSelect: (pairCount: number) => void;
	onClose: () => void;
}

export const PairCountModal = ({
	selectedPairCount,
	onSelect,
}: PairCountModalProps) => {
	const handleSelectAndContinue = (pairCount: number) => {
		logWizardInteraction("Pair count selected", { pairCount });
		onSelect(pairCount);
	};

	// Get difficulty label and color
	const getDifficulty = (count: number) => {
		if (count <= 6)
			return { label: "Easy", color: "text-green-600", bg: "bg-green-50" };
		if (count <= 12)
			return { label: "Medium", color: "text-yellow-600", bg: "bg-yellow-50" };
		return { label: "Hard", color: "text-red-600", bg: "bg-red-50" };
	};

	return (
		<div className="space-y-4">
			{/* Compact header */}
			<div className="text-center">
				<p className="text-gray-500 text-sm">Tap to select and continue</p>
			</div>

			{/* Pair Count Buttons - optimized for landscape/wide displays */}
			<div className="flex flex-wrap justify-center gap-3">
				{PAIR_COUNT_OPTIONS.map((count) => {
					const isSelected = selectedPairCount === count;
					const gridInfo = calculateGridDimensions(count);
					const difficulty = getDifficulty(count);

					return (
						<button
							type="button"
							key={count}
							onClick={() => handleSelectAndContinue(count)}
							className={`px-5 py-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center min-w-[80px] ${
								isSelected
									? "border-blue-500 bg-blue-50 shadow-lg scale-105"
									: `border-gray-200 bg-white can-hover:border-blue-300 can-hover:shadow-md can-hover:scale-105`
							}`}
						>
							<span
								className={`text-2xl font-bold ${isSelected ? "text-blue-600" : "text-gray-800"}`}
							>
								{count}
							</span>
							<span
								className={`text-xs ${isSelected ? "text-blue-500" : "text-gray-400"}`}
							>
								{gridInfo.columns}×{gridInfo.rows}
							</span>
							<span
								className={`text-xs mt-1 px-2 py-0.5 rounded-full font-medium ${difficulty.color} ${difficulty.bg}`}
							>
								{difficulty.label}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
};
