import { useOnlineStore } from "../stores/onlineStore";
import { Outlet } from "@tanstack/react-router";
import screenfull from "screenfull";
import { AdminSidebar } from "../components/AdminSidebar";
import { BackgroundViewer } from "../components/BackgroundViewer";
import { BuildInfoModal } from "../components/BuildInfoModal";
import { CardExplorerModal } from "../components/CardExplorerModal";
import {
	FixedGameControls,
	FloatingSettingsButton,
	SetupControls,
} from "../components/game";
import { SettingsSidebarWrapper } from "../components/layout";
import { LogViewerModal } from "../components/LogViewerModal";
import { MobileWarningModal } from "../components/MobileWarningModal";
import { Modal } from "../components/Modal";
import { OpponentDisconnectOverlay } from "../components/online";
import { PlayerMatchesModal } from "../components/PlayerMatchesModal";
import { Pong } from "../components/Pong";
import { PWAInstallModal } from "../components/PWAInstallModal";
import { ReloadConfirmationModal } from "../components/ReloadConfirmationModal";
import { ResetConfirmationModal } from "../components/ResetConfirmationModal";
import { SettingsMenu } from "../components/SettingsMenu";
import type { AppModel } from "../hooks/useAppModel";
export function AppShell({ model }: { model: AppModel }) {
	const onlineError = useOnlineStore((s) => s.error);
	const {
		backgroundLayerClass,
		backgroundLayerStyle,
		isPlaying,
		isStandalonePage,
		gameState,
		setShowReloadConfirmation,
		toggleFullscreen,
		setIsSettingsOpen,
		isFullscreen,
		handleResetClick,
		setShowAdminSidebar,
		showAdminSidebar,
		adminEnabled,
		isSettingsOpen,
		cardSize,
		autoSizeEnabled,
		useWhiteCardBackground,
		flipDuration,
		emojiSizePercentage,
		ttsEnabled,
		backgroundBlurEnabled,
		increaseCardSize,
		decreaseCardSize,
		toggleAutoSize,
		toggleWhiteCardBackground,
		increaseFlipDuration,
		decreaseFlipDuration,
		increaseEmojiSize,
		decreaseEmojiSize,
		toggleTtsEnabled,
		setBackgroundBlurEnabled,
		endTurn,
		setAdminEnabled,
		isIPad,
		isRunningAsPWA,
		handleShowPWAInstall,
		setShowBuildInfo,
		isOnlineMode,
		onlineGame,
		disconnectState,
		handleLeaveOnlineGame,
		showResetConfirmation,
		setShowResetConfirmation,
		handleReplay,
		handleNewGame,
		handleBackToModeSelect,
		isHost,
		showReloadConfirmation,
		selectedPlayerForMatches,
		players,
		setSelectedPlayerForMatches,
		effectiveCardBack,
		handlePlayerNameChange,
		updatePlayerColor,
		gameMode,
		localPlayerSlot,
		showPong,
		setShowPong,
		showCardExplorer,
		setShowCardExplorer,
		showBackgroundViewer,
		setShowBackgroundViewer,
		currentBackground,
		endGameEarly,
		toggleAllCardsAdmin,
		setShowLogViewer,
		showLogViewer,
		roomCode,
		showBuildInfo,
		showMobileWarning,
		handleMobileWarningClose,
		showPWAInstall,
		handlePWAInstallClose,
	} = model;
	if (model.isStandalonePage) return <Outlet />;
	return (
		<>
			{/* Background layer - blurred during gameplay */}
			{/* Extended beyond viewport (-8) to hide blur edge artifacts */}
			<div
				className={`fixed -inset-1 -z-10 ${backgroundLayerClass}`}
				style={backgroundLayerStyle}
			/>

			{/* Main content container */}
			<div
				className={`min-h-screen ${isPlaying ? "pt-4" : "py-8"} ${!isStandalonePage ? "overflow-hidden" : ""}`}
			>
				<div className="container mx-auto px-4 max-w-full">
					{gameState.gameStatus === "setup" ? (
						<SetupControls
							onReloadClick={() => setShowReloadConfirmation(true)}
							onToggleFullscreen={toggleFullscreen}
							onOpenSettings={() => setIsSettingsOpen(true)}
							isFullscreen={isFullscreen}
							screenfullEnabled={screenfull.isEnabled}
						/>
					) : (
						<FixedGameControls
							onResetClick={handleResetClick}
							onToggleFullscreen={toggleFullscreen}
							onOpenSettings={() => setIsSettingsOpen(true)}
							onToggleAdmin={() => setShowAdminSidebar(!showAdminSidebar)}
							isFullscreen={isFullscreen}
							adminEnabled={adminEnabled}
							showAdminSidebar={showAdminSidebar}
							screenfullEnabled={screenfull.isEnabled}
						/>
					)}

					{/* Settings Slide-over Menu - Available in both setup and gameplay */}
					<SettingsSidebarWrapper
						isOpen={isSettingsOpen}
						onClose={() => setIsSettingsOpen(false)}
					>
						<SettingsMenu
							cardSize={cardSize}
							autoSizeEnabled={autoSizeEnabled}
							useWhiteCardBackground={useWhiteCardBackground}
							flipDuration={flipDuration}
							emojiSizePercentage={emojiSizePercentage}
							ttsEnabled={ttsEnabled}
							backgroundBlurEnabled={backgroundBlurEnabled}
							onIncreaseSize={increaseCardSize}
							onDecreaseSize={decreaseCardSize}
							onToggleAutoSize={toggleAutoSize}
							onToggleWhiteCardBackground={toggleWhiteCardBackground}
							onIncreaseFlipDuration={increaseFlipDuration}
							onDecreaseFlipDuration={decreaseFlipDuration}
							onIncreaseEmojiSize={increaseEmojiSize}
							onDecreaseEmojiSize={decreaseEmojiSize}
							onToggleTtsEnabled={toggleTtsEnabled}
							onToggleBackgroundBlur={() =>
								setBackgroundBlurEnabled(!backgroundBlurEnabled)
							}
							onClose={() => setIsSettingsOpen(false)}
							onToggleFullscreen={toggleFullscreen}
							isFullscreen={isFullscreen}
							onEndTurn={endTurn}
							gameStatus={gameState.gameStatus}
							onEnableAdmin={() => {
								setAdminEnabled(true);
								setShowAdminSidebar(true);
							}}
							onShowPWAInstall={
								isIPad() && !isRunningAsPWA() ? handleShowPWAInstall : undefined
							}
							onReloadApp={() => setShowReloadConfirmation(true)}
							onViewBuildInfo={() => setShowBuildInfo(true)}
						/>
					</SettingsSidebarWrapper>

					{/* Settings Button - fixed bottom right, only visible when fullscreen is enabled */}
					<FloatingSettingsButton
						onClick={() => setIsSettingsOpen(true)}
						visible={screenfull.isEnabled}
					/>

					{isOnlineMode && onlineError && (
						<div
							role="alert"
							className="relative z-[110] mx-auto mb-4 max-w-lg rounded-xl bg-red-50 p-4 text-red-900"
						>
							{onlineError}
							<button
								type="button"
								className="ml-4 underline"
								onClick={() => useOnlineStore.getState().setError(null)}
							>
								Dismiss
							</button>
						</div>
					)}
					<main>
						<Outlet />
					</main>

					{isOnlineMode &&
						gameState.gameStatus === "playing" &&
						onlineGame.syncError && (
							<div
								role="alert"
								className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center"
							>
								<div className="rounded-xl bg-white p-8 text-center">
									<h2 className="text-xl font-bold">Game paused</h2>
									<p>{onlineGame.syncError}</p>
									<button
										type="button"
										className="mt-4 rounded bg-indigo-600 px-4 py-2 text-white"
										onClick={() => void onlineGame.resynchronize()}
									>
										Reconnect
									</button>
								</div>
							</div>
						)}
					{/* Opponent Disconnect Overlay - Online Mode Only */}
					{isOnlineMode &&
						gameState.gameStatus === "playing" &&
						disconnectState.isDisconnected && (
							<OpponentDisconnectOverlay
								isVisible={true}
								opponentName={disconnectState.opponentName}
								secondsRemaining={disconnectState.secondsRemaining}
								onLeaveGame={handleLeaveOnlineGame}
							/>
						)}

					{/* Reset Confirmation Modal */}
					<Modal
						isOpen={showResetConfirmation}
						onClose={() => setShowResetConfirmation(false)}
						title="Reset Game"
					>
						<ResetConfirmationModal
							onReplay={handleReplay}
							onNewGame={handleNewGame}
							onChangeMode={handleBackToModeSelect}
							onCancel={() => setShowResetConfirmation(false)}
							isOnlineMode={Boolean(isOnlineMode)}
							isHost={isHost}
						/>
					</Modal>

					{/* Reload App Confirmation Modal */}
					<Modal
						isOpen={showReloadConfirmation}
						onClose={() => setShowReloadConfirmation(false)}
						title="Reload App"
					>
						<ReloadConfirmationModal
							onCancel={() => setShowReloadConfirmation(false)}
							onConfirm={() => window.location.reload()}
						/>
					</Modal>

					{/* Player Matches Modal */}
					{selectedPlayerForMatches !== null &&
						players[selectedPlayerForMatches - 1] && (
							<PlayerMatchesModal
								isOpen={selectedPlayerForMatches !== null}
								onClose={() => setSelectedPlayerForMatches(null)}
								player={players[selectedPlayerForMatches - 1]}
								cards={gameState.cards}
								useWhiteCardBackground={useWhiteCardBackground}
								emojiSizePercentage={emojiSizePercentage}
								cardBack={effectiveCardBack}
								onPlayerNameChange={(playerId, name) => {
									handlePlayerNameChange(playerId as 1 | 2, name);
								}}
								onPlayerColorChange={(playerId, color) => {
									updatePlayerColor(playerId as 1 | 2, color);
								}}
								canEditPlayer={
									gameMode === "local" || // Local mode: can edit both
									localPlayerSlot === 1 || // Host (slot 1): can edit both
									selectedPlayerForMatches === localPlayerSlot // Guest: can only edit own player
								}
							/>
						)}

					{/* Hidden Pong Game */}
					<Pong isOpen={showPong} onClose={() => setShowPong(false)} />

					{/* Card Explorer Modal */}
					<CardExplorerModal
						isOpen={showCardExplorer}
						onClose={() => setShowCardExplorer(false)}
						cards={gameState.cards}
						useWhiteCardBackground={useWhiteCardBackground}
						emojiSizePercentage={emojiSizePercentage}
						cardBack={effectiveCardBack}
					/>

					{/* Background Viewer */}
					<BackgroundViewer
						isOpen={showBackgroundViewer}
						onClose={() => setShowBackgroundViewer(false)}
						background={currentBackground}
					/>

					{/* Admin Sidebar */}
					{adminEnabled && (
						<AdminSidebar
							isOpen={showAdminSidebar}
							onClose={() => setShowAdminSidebar(false)}
							onEndGameEarly={() => {
								endGameEarly();
								setShowAdminSidebar(false);
							}}
							onToggleFlipAll={toggleAllCardsAdmin}
							allCardsFlipped={
								gameState.cards.length > 0 &&
								gameState.cards
									.filter((c) => !c.isMatched)
									.every((c) => c.isFlipped)
							}
							onViewLogs={() => setShowLogViewer(true)}
						/>
					)}

					{/* Log Viewer Modal */}
					<LogViewerModal
						isOpen={showLogViewer}
						onClose={() => setShowLogViewer(false)}
						roomCode={roomCode ?? undefined}
					/>
					{/* Build Info Modal */}
					<BuildInfoModal
						isOpen={showBuildInfo}
						onClose={() => setShowBuildInfo(false)}
					/>

					{/* Mobile Warning Modal */}
					<MobileWarningModal
						isOpen={showMobileWarning}
						onClose={handleMobileWarningClose}
					/>

					{/* PWA Install Modal */}
					<PWAInstallModal
						isOpen={showPWAInstall}
						onClose={handlePWAInstallClose}
					/>
				</div>
			</div>
		</>
	);
}
