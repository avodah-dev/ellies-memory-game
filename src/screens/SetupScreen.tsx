import { BackgroundModal } from "../components/BackgroundModal";
import { CardBackModal } from "../components/CardBackModal";
import { CardPackModal } from "../components/CardPackModal";
import { GameStartModal } from "../components/GameStartModal";
import { Modal } from "../components/Modal";
import { PairCountModal } from "../components/PairCountModal";
import { ThemeSelectorModal } from "../components/ThemeSelectorModal";
import { type BackgroundTheme } from "../hooks/useBackgroundSelector";
import { type CardBackType } from "../hooks/useCardBackSelector";
import { useAppModelStore } from "../stores/appModelStore";
export function SetupScreen() {
	const model = useAppModelStore((s) => s.model);
	if (!model) return null;
	const {
		setupStep,
		currentPath,
		cancelSetupFlow,
		handleStartModalBack,
		cameFromTheme,
		isResetting,
		players,
		gameState,
		handleStartGame,
		handlePlayerNameChange,
		updatePlayerColor,
		navigateToStep,
		handleThemeSelect,
		handleBuildCustom,
		cardPacks,
		selectedPack,
		handlePackChange,
		handleBackgroundModalBack,
		selectedBackground,
		handleBackgroundChange,
		handleCardBackModalBack,
		selectedCardBack,
		handleCardBackChange,
		handlePairCountModalBack,
		gameMode,
		onlinePairCount,
		localPairCount,
		handlePairCountChange,
	} = model;
	return (
		<>
			{/* Game Start Modal */}
			<Modal
				isOpen={setupStep === "startGame" && currentPath === "/local/start"}
				onClose={cancelSetupFlow}
				onBack={handleStartModalBack}
				title={
					cameFromTheme
						? "Step 3: Who Goes First?"
						: isResetting
							? "Step 5: Who Goes First?"
							: "Step 6: Who Goes First?"
				}
			>
				<GameStartModal
					players={players}
					currentPlayer={gameState.currentPlayer}
					onStartGame={handleStartGame}
					onPlayerNameChange={handlePlayerNameChange}
					onPlayerColorChange={updatePlayerColor}
					onBack={handleStartModalBack}
					isResetting={isResetting}
				/>
			</Modal>

			{/* Theme Selector Modal */}
			<Modal
				isOpen={setupStep === "theme" && currentPath === "/local/theme"}
				onClose={cancelSetupFlow}
				onBack={() => {
					navigateToStep("modeSelect", "back button from theme modal");
				}}
				title={
					isResetting
						? "Step 1: Choose Your Theme"
						: "Step 1: Choose Your Theme"
				}
			>
				<ThemeSelectorModal
					onSelectTheme={handleThemeSelect}
					onBuildCustom={handleBuildCustom}
					onClose={cancelSetupFlow}
				/>
			</Modal>

			{/* Card Pack Modal */}
			<Modal
				isOpen={setupStep === "cardPack" && currentPath === "/local/card-pack"}
				onClose={cancelSetupFlow}
				title={
					isResetting
						? "Step 1: Choose Your Card Pack"
						: "Step 2: Choose Your Card Pack"
				}
			>
				<CardPackModal
					cardPacks={cardPacks}
					selectedPack={selectedPack}
					onSelect={handlePackChange}
					onClose={cancelSetupFlow}
				/>
			</Modal>

			{/* Background Modal */}
			<Modal
				isOpen={
					setupStep === "background" && currentPath === "/local/background"
				}
				onClose={cancelSetupFlow}
				onBack={handleBackgroundModalBack}
				title={
					isResetting
						? "Step 2: Choose Your Background"
						: "Step 3: Choose Your Background"
				}
			>
				<BackgroundModal
					selectedBackground={selectedBackground}
					onSelect={(bg) => handleBackgroundChange(bg as BackgroundTheme)}
					onClose={cancelSetupFlow}
					onBack={handleBackgroundModalBack}
					isResetting={isResetting}
				/>
			</Modal>

			{/* Card Back Modal */}
			<Modal
				isOpen={setupStep === "cardBack" && currentPath === "/local/card-back"}
				onClose={cancelSetupFlow}
				onBack={handleCardBackModalBack}
				title={
					isResetting
						? "Step 3: Choose Your Card Back"
						: "Step 4: Choose Your Card Back"
				}
			>
				<CardBackModal
					selectedCardBack={selectedCardBack}
					onSelect={(cb) => handleCardBackChange(cb as CardBackType)}
					onClose={cancelSetupFlow}
					onBack={handleCardBackModalBack}
					isResetting={isResetting}
				/>
			</Modal>

			{/* Pair Count Modal */}
			<Modal
				isOpen={
					setupStep === "pairCount" && currentPath === "/local/pair-count"
				}
				onClose={cancelSetupFlow}
				onBack={handlePairCountModalBack}
				title={
					cameFromTheme
						? "Step 2: How Many Pairs?"
						: isResetting
							? "Step 4: How Many Pairs?"
							: "Step 5: How Many Pairs?"
				}
			>
				<PairCountModal
					selectedPairCount={
						gameMode === "online" ? onlinePairCount : localPairCount
					}
					onSelect={handlePairCountChange}
					onClose={cancelSetupFlow}
				/>
			</Modal>
		</>
	);
}
