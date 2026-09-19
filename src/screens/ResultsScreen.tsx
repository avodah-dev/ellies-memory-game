import { GameOver } from "../components/GameOver";
import { useAppModelStore } from "../stores/appModelStore";
export function ResultsScreen() {
	const model = useAppModelStore((s) => s.model);
	if (!model) return null;
	const {
		gameState,
		currentPath,
		winner,
		isTie,
		players,
		handleResetClick,
		setShowCardExplorer,
		setShowBackgroundViewer,
		resetGame,
		navigateToStep,
		isOnlineMode,
		isHost,
		handleLeaveOnlineGame,
	} = model;
	return (
		<>
			{gameState.gameStatus === "finished" &&
				currentPath === "/game-over" &&
				(winner !== null || isTie === true) && (
					<GameOver
						winner={winner}
						players={players}
						cards={gameState.cards}
						isTie={isTie}
						onPlayAgain={handleResetClick}
						onExploreCards={() => setShowCardExplorer(true)}
						onViewBackground={() => setShowBackgroundViewer(true)}
						onClose={() => {
							resetGame();
							navigateToStep(null, "game over close");
						}}
						isOnlineMode={Boolean(isOnlineMode)}
						isHost={isHost}
						onLeaveGame={handleLeaveOnlineGame}
					/>
				)}
		</>
	);
}
