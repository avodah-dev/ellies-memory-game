import { ModeSelector } from "../components/online";
import { useAppModelStore } from "../stores/appModelStore";
import type { GameMode } from "../types";
export function HomeScreen() {
	const model = useAppModelStore((s) => s.model);
	if (!model) return null;
	const {
		currentPath,
		setupStep,
		gameMode,
		setGameMode,
		navigateToStep,
		navigate,
	} = model;
	return (
		<>
			{/* Mode Selection Screen (merged with Welcome) */}
			{(currentPath === "/" ||
				(setupStep === "modeSelect" && gameMode !== "online")) && (
				<div className="fixed inset-0 flex items-center justify-center z-0">
					<div className="bg-white rounded-xl shadow-lg p-8 max-w-2xl mx-auto">
						<ModeSelector
							onSelectMode={(mode: GameMode) => {
								setGameMode(mode);
								if (mode === "local") {
									navigateToStep("theme", "local mode selected");
								} else if (mode === "online") {
									sessionStorage.setItem("appNavigation", "true");
									navigate({ to: "/online" });
								}
								// For online mode, navigate to online route
							}}
						/>
					</div>
				</div>
			)}
		</>
	);
}
