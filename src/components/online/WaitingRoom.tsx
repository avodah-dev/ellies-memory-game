/**
 * WaitingRoom - Shows players waiting for game to start
 *
 * Host can configure game settings (card pack, background, card back).
 * Guest sees previews of the host's selected settings.
 */

import { useEffect, useState } from "react";
import { BACKGROUND_OPTIONS } from "../../hooks/useBackgroundSelector";
import { CARD_BACK_OPTIONS } from "../../hooks/useCardBackSelector";
import { CARD_PACKS } from "../../hooks/useCardPacks";
import { useOnlineStore } from "../../stores/onlineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { CardPack, GameTheme, Room } from "../../types";
import { DEFAULT_PAIR_COUNT } from "../../utils/gridLayout";
import { BackgroundModal } from "../BackgroundModal";
import { CardBackModal } from "../CardBackModal";
import { CardPackModal } from "../CardPackModal";
import { Modal } from "../Modal";
import { PairCountModal } from "../PairCountModal";
import { ThemeSelectorModal } from "../ThemeSelectorModal";

type OpenModal =
	| "none"
	| "theme"
	| "cardPack"
	| "background"
	| "cardBack"
	| "pairCount";

interface WaitingRoomProps {
	roomCode: string;
	room: Room;
	isHost: boolean;
	opponentConnected: boolean;
	onLeave: () => void;
	onStartGame: () => void;
	isStarting: boolean;
}

export const WaitingRoom = ({
	room,
	isHost,
	opponentConnected,
	onLeave,
	onStartGame,
	isStarting,
}: WaitingRoomProps) => {
	const [openModal, setOpenModal] = useState<OpenModal>("none");
	const { updateRoomConfig, getLastOnlinePreferences, presenceData } =
		useOnlineStore();
	const setOnlinePairCount = useSettingsStore(
		(state) => state.setOnlinePairCount,
	);
	const savedOnlinePairCount = useSettingsStore(
		(state) => state.settings.onlinePairCount,
	);

	const players = Object.entries(presenceData);
	const hasOpponent = players.length === 2;
	const canStart = isHost && hasOpponent && opponentConnected && !isStarting;

	// Sort players by slot
	const sortedPlayers = [...players].sort(([, a], [, b]) => a.slot - b.slot);

	// Get current settings from room config, or load stored preferences if host and no config exists
	const getInitialSettings = () => {
		if (
			room.config?.cardPack &&
			room.config?.background &&
			room.config?.cardBack
		) {
			return {
				cardPack: room.config.cardPack,
				background: room.config.background,
				cardBack: room.config.cardBack,
			};
		}

		// If host and no config, try to load stored preferences
		if (isHost) {
			const storedPrefs = getLastOnlinePreferences();
			if (
				storedPrefs.cardPack &&
				storedPrefs.background &&
				storedPrefs.cardBack
			) {
				return {
					cardPack: storedPrefs.cardPack as CardPack,
					background: storedPrefs.background,
					cardBack: storedPrefs.cardBack,
				};
			}
		}

		// Fall back to defaults
		return {
			cardPack: "animals" as CardPack,
			background: "rainbow",
			cardBack: "default",
		};
	};

	const initialSettings = getInitialSettings();
	const currentCardPack = room.config?.cardPack || initialSettings.cardPack;
	const currentBackground =
		room.config?.background || initialSettings.background;
	const currentCardBack = room.config?.cardBack || initialSettings.cardBack;
	// Use room config pairCount, fallback to DEFAULT_PAIR_COUNT (not guest's local setting)
	// This ensures both host and guest see the same value
	const currentPairCount = room.config?.pairCount ?? DEFAULT_PAIR_COUNT;

	// Load stored preferences into room config if host and no config exists
	useEffect(() => {
		if (
			isHost &&
			!room.config?.cardPack &&
			!room.config?.background &&
			!room.config?.cardBack
		) {
			const storedPrefs = getLastOnlinePreferences();
			if (
				storedPrefs.cardPack &&
				storedPrefs.background &&
				storedPrefs.cardBack
			) {
				updateRoomConfig({
					cardPack: storedPrefs.cardPack as CardPack,
					background: storedPrefs.background,
					cardBack: storedPrefs.cardBack,
					pairCount: savedOnlinePairCount,
				}).catch(console.error);
			}
		}
	}, [
		isHost,
		room.config,
		getLastOnlinePreferences,
		updateRoomConfig,
		savedOnlinePairCount,
	]);

	// Find display info for current selections
	const cardPackInfo = CARD_PACKS.find((p) => p.id === currentCardPack);
	const backgroundInfo = BACKGROUND_OPTIONS.find(
		(b) => b.id === currentBackground,
	);
	const cardBackInfo = CARD_BACK_OPTIONS.find((c) => c.id === currentCardBack);

	// Handle theme selection (host only)
	const handleThemeSelect = async (theme: GameTheme) => {
		if (!isHost) return;
		await updateRoomConfig({
			cardPack: theme.cardPack as CardPack,
			background: theme.background,
			cardBack: theme.cardBack,
		});
		setOpenModal("none");
	};

	const handleBuildCustom = () => {
		if (!isHost) return;
		setOpenModal("cardPack"); // Start the existing sequential flow
	};

	// Handle settings changes (host only) - sequential wizard flow
	const handleCardPackChange = async (packId: CardPack) => {
		if (!isHost) return;
		await updateRoomConfig({ cardPack: packId });
		// Advance to background modal
		setOpenModal("background");
	};

	const handleBackgroundChange = async (backgroundId: string) => {
		if (!isHost) return;
		await updateRoomConfig({ background: backgroundId });
		// Advance to card back modal
		setOpenModal("cardBack");
	};

	const handleCardBackChange = async (cardBackId: string) => {
		if (!isHost) return;
		await updateRoomConfig({ cardBack: cardBackId });
		// Advance to pair count modal
		setOpenModal("pairCount");
	};

	const handlePairCountChange = async (pairCount: number) => {
		if (!isHost) return;
		await updateRoomConfig({ pairCount });
		// Persist to localStorage for future sessions
		setOnlinePairCount(pairCount);
		// Close wizard - all settings configured
		setOpenModal("none");
	};

	// Render a settings preview tile
	const renderSettingTile = (
		label: string,
		modal: OpenModal,
		preview: React.ReactNode,
		displayName: string,
	) => (
		<button
			type="button"
			onClick={() => {
				if (isHost) {
					setOpenModal(modal);
				}
			}}
			disabled={!isHost}
			title={isHost ? `Change ${label.toLowerCase()}` : undefined}
			className={`p-2 rounded-lg border-2 transition-all text-left w-full ${
				isHost
					? "hover:border-blue-400 hover:bg-blue-50 cursor-pointer"
					: "cursor-default"
			} border-gray-200 bg-white`}
		>
			<div className="flex items-center gap-2">
				<div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden">
					{preview}
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-xs text-gray-500 uppercase tracking-wide leading-tight">
						{label}
					</p>
					<p className="font-medium text-gray-800 truncate text-xs">
						{displayName}
					</p>
				</div>
				{isHost && (
					<svg
						className="w-4 h-4 text-gray-400 flex-shrink-0"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M9 5l7 7-7 7"
						/>
					</svg>
				)}
			</div>
		</button>
	);

	// Render card pack preview
	const renderCardPackPreview = () => (
		<div className="w-full h-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-lg">
			{cardPackInfo?.emoji || "🃏"}
		</div>
	);

	// Render background preview
	const renderBackgroundPreview = () => {
		if (backgroundInfo?.imageUrl) {
			return (
				<img
					src={backgroundInfo.imageUrl}
					alt={backgroundInfo.name}
					className="w-full h-full object-cover"
				/>
			);
		}
		return (
			<div
				className={`w-full h-full bg-gradient-to-br ${backgroundInfo?.gradient || "from-gray-300 to-gray-400"}`}
			/>
		);
	};

	// Render card back preview
	const renderCardBackPreview = () => {
		if (cardBackInfo?.imageUrl) {
			return (
				<img
					src={cardBackInfo.imageUrl}
					alt={cardBackInfo.name}
					className="w-full h-full object-cover"
				/>
			);
		}
		if (cardBackInfo?.solidColor) {
			return (
				<div
					className="w-full h-full flex items-center justify-center text-white font-bold text-sm"
					style={{ backgroundColor: cardBackInfo.solidColor }}
				>
					?
				</div>
			);
		}
		return (
			<div
				className={`w-full h-full bg-gradient-to-br ${cardBackInfo?.gradient || "from-indigo-500 to-purple-600"} flex items-center justify-center text-white font-bold text-sm`}
			>
				{cardBackInfo?.emoji || "?"}
			</div>
		);
	};

	return (
		<div className="text-center space-y-3">
			<div>
				<h2 className="text-xl font-bold text-gray-800 mb-1">
					{isHost ? "Waiting for Player" : "Waiting for Host"}
				</h2>
				<p className="text-sm text-gray-600">
					{isHost
						? hasOpponent
							? "Player joined! Configure settings and start when ready."
							: "Share the room code with your friend"
						: "Waiting for the host to start the game..."}
				</p>
			</div>

			{/* Players + Settings Horizontal Layout */}
			<div className="flex flex-col lg:flex-row gap-4 items-start">
				{/* Players - Compact Horizontal Cards */}
				<div className="flex flex-col gap-2 w-full lg:w-auto lg:min-w-[200px]">
					{sortedPlayers.map(([odahId, player]) => (
						<div
							key={odahId}
							className="p-2 rounded-lg border-2 transition-all flex items-center gap-2"
							style={{
								borderColor: player.color,
								backgroundColor: `${player.color}15`,
							}}
						>
							<div
								className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
								style={{ backgroundColor: player.color }}
							>
								{player.name.charAt(0).toUpperCase()}
							</div>
							<div className="flex-1 min-w-0 text-left">
								<p className="font-bold text-gray-800 text-xs leading-tight">
									{player.name}
								</p>
								<div className="flex items-center gap-1">
									<p className="text-xs text-gray-500">
										{player.slot === 1 ? "Host" : "Guest"}
									</p>
									<div
										className={`w-1.5 h-1.5 rounded-full ${
											player.slot === 1 || opponentConnected
												? "bg-green-500"
												: "bg-gray-400 animate-pulse"
										}`}
									/>
									<span className="text-xs text-gray-500">
										{player.slot === 1 || opponentConnected
											? "Online"
											: "Connecting..."}
									</span>
								</div>
							</div>
						</div>
					))}

					{/* Empty slot placeholder */}
					{!hasOpponent && (
						<div className="p-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-center gap-2">
							<div className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-gray-200 text-gray-400 flex-shrink-0">
								?
							</div>
							<div className="flex-1 min-w-0 text-left">
								<p className="font-medium text-gray-400 text-xs leading-tight">
									Waiting...
								</p>
								<div className="flex items-center gap-1">
									<p className="text-xs text-gray-400">for player to join</p>
									<div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />
									<span className="text-xs text-gray-400">Waiting</span>
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Game Settings - 2x2 Grid */}
				<div className="bg-gray-50 rounded-xl px-3 pb-3 pt-0 flex-1">
					<div className="space-y-2 pt-0">
						{/* Choose Theme Button - Host only - Prominent First Option */}
						{isHost && (
							<button
								type="button"
								onClick={() => setOpenModal("theme")}
								className="p-3 rounded-lg border-2 border-purple-400 bg-gradient-to-br from-purple-100 to-blue-100 hover:border-purple-500 hover:from-purple-200 hover:to-blue-200 hover:ring-2 hover:ring-purple-300 hover:ring-opacity-50 transition-all duration-200 text-left w-full shadow-sm"
							>
								<div className="flex items-center gap-3">
									<div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-xl shadow-md">
										🎨
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-xs text-purple-700 uppercase tracking-wide font-semibold">
											Quick Setup
										</p>
										<p className="font-bold text-gray-900 text-sm">
											Choose Theme
										</p>
									</div>
									<svg
										className="w-5 h-5 text-purple-600 flex-shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M9 5l7 7-7 7"
										/>
									</svg>
								</div>
							</button>
						)}

						{/* Other Settings - 2x2 Grid */}
						<div className="grid grid-cols-2 gap-2">
							{/* Card Pack */}
							{renderSettingTile(
								"Card Pack",
								"cardPack",
								renderCardPackPreview(),
								cardPackInfo?.name || currentCardPack,
							)}

							{/* Background */}
							{renderSettingTile(
								"Background",
								"background",
								renderBackgroundPreview(),
								backgroundInfo?.name || currentBackground,
							)}

							{/* Card Back */}
							{renderSettingTile(
								"Card Back",
								"cardBack",
								renderCardBackPreview(),
								cardBackInfo?.name || currentCardBack,
							)}

							{/* Pair Count */}
							{renderSettingTile(
								"Cards",
								"pairCount",
								<div className="w-full h-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
									{currentPairCount * 2}
								</div>,
								`${currentPairCount} pairs`,
							)}

							{/* Empty space if host, or placeholder if guest */}
							{!isHost && (
								<div className="p-2 rounded-lg border-2 border-gray-200 bg-gray-50 opacity-50">
									<div className="flex items-center gap-2">
										<div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-sm text-gray-400">
											⚙️
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-xs text-gray-400 uppercase tracking-wide leading-tight">
												Settings
											</p>
											<p className="font-medium text-gray-400 truncate text-xs">
												Host controls
											</p>
										</div>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="flex gap-3 justify-center">
				<button
					type="button"
					onClick={onLeave}
					className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg transition-colors text-sm"
				>
					Leave Room
				</button>
				{isHost && (
					<button
						type="button"
						onClick={onStartGame}
						disabled={!canStart}
						className={`px-6 py-2 font-bold rounded-lg transition-all flex items-center gap-2 text-sm ${
							canStart
								? "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
								: "bg-gray-200 text-gray-400 cursor-not-allowed"
						}`}
					>
						{isStarting ? "Starting…" : "Start Game"}
					</button>
				)}
			</div>

			{/* Helper text for host */}
			{isHost && !canStart && (
				<p className="text-xs text-gray-500">
					{!hasOpponent
						? "Waiting for another player to join..."
						: !opponentConnected
							? "Waiting for player to connect..."
							: "Ready to start!"}
				</p>
			)}

			{/* Wizard Modals */}
			{/* Theme Selector Modal */}
			<Modal
				isOpen={openModal === "theme"}
				onClose={() => setOpenModal("none")}
				title="Choose Your Theme"
			>
				<ThemeSelectorModal
					onSelectTheme={handleThemeSelect}
					onBuildCustom={handleBuildCustom}
					onClose={() => setOpenModal("none")}
				/>
			</Modal>

			{/* Card Pack Modal */}
			<Modal
				isOpen={openModal === "cardPack"}
				onClose={() => setOpenModal("none")}
				title="Step 1: Choose Card Pack"
			>
				<CardPackModal
					cardPacks={CARD_PACKS}
					selectedPack={currentCardPack}
					onSelect={(packId) => handleCardPackChange(packId as CardPack)}
					onClose={() => setOpenModal("none")}
				/>
			</Modal>

			{/* Background Modal */}
			<Modal
				isOpen={openModal === "background"}
				onClose={() => setOpenModal("none")}
				onBack={() => setOpenModal("cardPack")}
				title="Step 2: Choose Background"
			>
				<BackgroundModal
					selectedBackground={currentBackground}
					onSelect={(backgroundId) => handleBackgroundChange(backgroundId)}
					onClose={() => setOpenModal("none")}
					onBack={() => setOpenModal("cardPack")}
				/>
			</Modal>

			{/* Card Back Modal */}
			<Modal
				isOpen={openModal === "cardBack"}
				onClose={() => setOpenModal("none")}
				onBack={() => setOpenModal("background")}
				title="Step 3: Choose Card Back"
			>
				<CardBackModal
					selectedCardBack={currentCardBack}
					onSelect={(cardBackId) => handleCardBackChange(cardBackId)}
					onClose={() => setOpenModal("none")}
					onBack={() => setOpenModal("background")}
				/>
			</Modal>

			{/* Pair Count Modal */}
			<Modal
				isOpen={openModal === "pairCount"}
				onClose={() => setOpenModal("none")}
				onBack={() => setOpenModal("cardBack")}
				title="Step 4: How Many Pairs?"
			>
				<PairCountModal
					selectedPairCount={currentPairCount}
					onSelect={(pairCount) => handlePairCountChange(pairCount)}
					onClose={() => setOpenModal("none")}
				/>
			</Modal>
		</div>
	);
};
