import { GameplayHeader } from "../components/game";
import { GameBoard } from "../components/GameBoard";
import { useAppModelStore } from "../stores/appModelStore";
export function GameplayScreen() {
	const model = useAppModelStore((s) => s.model);
	if (!model) return null;
	const {
		gameState,
		currentPath,
		isOnlineMode,
		room,
		boardWrapperRef,
		scoreboardRef,
		players,
		glowingPlayer,
		gameMode,
		localPlayerSlot,
		roomCode,
		handleOpenPlayerMatches,
		gameBoardContainerRef,
		flipCard,
		cardSize,
		isAnimatingCards,
		useWhiteCardBackground,
		emojiSizePercentage,
		effectiveCardBack,
		cursorSyncEnabled,
		handleCursorMove,
		handleCursorLeave,
		remoteCursorPeer,
	} = model;
	return (
		<>
			{gameState.gameStatus !== "setup" &&
				(currentPath === "/local/game" || currentPath === "/online/game") &&
				(!isOnlineMode || room?.status === "playing") && (
					<div
						ref={boardWrapperRef}
						className="flex flex-col gap-6 items-center w-full max-w-full"
					>
						{/* Compact Header - Players Points and Current Player */}
						<div ref={scoreboardRef}>
							<GameplayHeader
								players={players}
								currentPlayer={gameState.currentPlayer}
								cards={gameState.cards}
								glowingPlayer={glowingPlayer}
								gameMode={gameMode}
								localPlayerSlot={localPlayerSlot}
								roomCode={roomCode}
								isOnlineMode={Boolean(isOnlineMode)}
								onOpenPlayerMatches={handleOpenPlayerMatches}
							/>
						</div>

						{/* Center Game Area - Full Width Below */}
						<div
							ref={gameBoardContainerRef}
							className="w-full flex justify-center"
						>
							<GameBoard
								cards={gameState.cards}
								onCardClick={flipCard}
								cardSize={cardSize}
								isAnimating={isAnimatingCards}
								useWhiteCardBackground={useWhiteCardBackground}
								emojiSizePercentage={emojiSizePercentage}
								cardBack={effectiveCardBack}
								onCursorMove={cursorSyncEnabled ? handleCursorMove : undefined}
								onCursorLeave={
									cursorSyncEnabled ? handleCursorLeave : undefined
								}
								remoteCursorPeer={remoteCursorPeer}
							/>
						</div>
					</div>
				)}
		</>
	);
}
