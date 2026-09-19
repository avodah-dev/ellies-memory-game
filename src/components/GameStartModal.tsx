import { debugLog } from "../utils/debugLog";
import { useEffect, useState } from "react";
import type { Player } from "../types";
import { PlayerNamePicker } from "./PlayerNamePicker";

const ENABLE_SETUP_DEBUG_LOGS = true;

const logWizardInteraction = (...args: unknown[]) => {
	if (!ENABLE_SETUP_DEBUG_LOGS) return;
	debugLog("[Setup Wizard Interaction]", ...args);
};

interface GameStartModalProps {
	players: Player[];
	currentPlayer: number;
	onStartGame: (firstPlayer: number) => void;
	onPlayerNameChange?: (playerId: 1 | 2, newName: string) => void;
	onPlayerColorChange?: (playerId: 1 | 2, newColor: string) => void;
	onBack?: () => void;
	isResetting?: boolean;
}

export const GameStartModal = ({
	players,
	currentPlayer,
	onStartGame,
	onPlayerNameChange,
	onPlayerColorChange,
}: GameStartModalProps) => {
	const [selectedPlayer, setSelectedPlayer] = useState<1 | 2>(
		currentPlayer as 1 | 2,
	);
	const [editingPlayer, setEditingPlayer] = useState<1 | 2 | null>(null);
	const player1 = players.find((p) => p.id === 1);
	const player2 = players.find((p) => p.id === 2);
	const [tempNames, setTempNames] = useState({
		1: player1?.name || "Player 1",
		2: player2?.name || "Player 2",
	});
	const [tempColors, setTempColors] = useState({
		1: player1?.color || "#3b82f6",
		2: player2?.color || "#10b981",
	});

	const handleSwapPlayers = () => {
		setTempNames((prev) => ({
			1: prev[2],
			2: prev[1],
		}));
		setTempColors((prev) => ({
			1: prev[2],
			2: prev[1],
		}));
		// Note: Don't call swapPlayersStore() here - we only update local state during editing.
		// The store is updated when "Start Game" is clicked via handleStart().
	};

	useEffect(() => {
		const p1 = players.find((p) => p.id === 1);
		const p2 = players.find((p) => p.id === 2);
		setTempNames({
			1: p1?.name || "Player 1",
			2: p2?.name || "Player 2",
		});
		setTempColors({
			1: p1?.color || "#3b82f6",
			2: p2?.color || "#10b981",
		});
	}, [players]);

	const colorOptions = [
		"#3b82f6", // Blue
		"#10b981", // Green
		"#f59e0b", // Amber
		"#ef4444", // Red
		"#8b5cf6", // Purple
		"#ec4899", // Pink
		"#06b6d4", // Cyan
		"#f97316", // Orange
		"#84cc16", // Lime
		"#6366f1", // Indigo
	];

	const handleStart = () => {
		logWizardInteraction("Start game clicked", {
			selectedPlayer,
			tempNames,
			tempColors,
		});
		const currentPlayer1 = players.find((p) => p.id === 1);
		const currentPlayer2 = players.find((p) => p.id === 2);

		const nameChanged =
			tempNames[1] !== currentPlayer1?.name ||
			tempNames[2] !== currentPlayer2?.name;
		const colorChanged =
			tempColors[1] !== currentPlayer1?.color ||
			tempColors[2] !== currentPlayer2?.color;

		if (tempNames[1] !== currentPlayer1?.name && onPlayerNameChange) {
			onPlayerNameChange(1, tempNames[1]);
		}
		if (tempNames[2] !== currentPlayer2?.name && onPlayerNameChange) {
			onPlayerNameChange(2, tempNames[2]);
		}
		if (tempColors[1] !== currentPlayer1?.color && onPlayerColorChange) {
			onPlayerColorChange(1, tempColors[1]);
		}
		if (tempColors[2] !== currentPlayer2?.color && onPlayerColorChange) {
			onPlayerColorChange(2, tempColors[2]);
		}

		if (nameChanged || colorChanged) {
			setTimeout(() => {
				onStartGame(selectedPlayer);
			}, 0);
		} else {
			onStartGame(selectedPlayer);
		}
	};

	const handleNameClick = (playerId: 1 | 2) => {
		setEditingPlayer(playerId);
	};

	const handleNameChange = (playerId: 1 | 2, newName: string) => {
		setTempNames((prev) => ({
			...prev,
			[playerId]: newName,
		}));
	};

	const handleColorChange = (playerId: 1 | 2, newColor: string) => {
		setTempColors((prev) => ({
			...prev,
			[playerId]: newColor,
		}));
	};

	const handlePlayerSelection = (playerId: 1 | 2) => {
		logWizardInteraction("Player selection toggled", {
			playerId,
			previousSelection: selectedPlayer,
		});
		setSelectedPlayer(playerId);
	};

	const handleNameCancel = () => {
		if (editingPlayer) {
			const currentPlayer =
				editingPlayer === 1
					? players.find((p) => p.id === 1)?.name || "Player 1"
					: players.find((p) => p.id === 2)?.name || "Player 2";
			setTempNames((prev) => ({
				...prev,
				[editingPlayer]: currentPlayer,
			}));
			setEditingPlayer(null);
		}
	};

	// Compact player chip component
	const PlayerChip = ({
		playerId,
		isSelected,
		otherIsEditing,
	}: {
		playerId: 1 | 2;
		isSelected: boolean;
		otherIsEditing: boolean;
	}) => {
		const name = tempNames[playerId];
		const color = tempColors[playerId];

		return (
			<button
				type="button"
				onClick={() => {
					if (!otherIsEditing) {
						handlePlayerSelection(playerId);
					}
				}}
				disabled={otherIsEditing}
				className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-200 min-h-[56px] ${
					isSelected
						? "shadow-lg ring-2 ring-opacity-40"
						: "border-gray-200 bg-white hover:border-gray-300"
				} ${otherIsEditing ? "opacity-50 cursor-not-allowed" : "hover:scale-[1.02]"}`}
				style={
					isSelected
						? ({
								borderColor: color,
								backgroundColor: `${color}15`,
								"--tw-ring-color": color,
							} as React.CSSProperties & { "--tw-ring-color": string })
						: {}
				}
			>
				{/* Color dot */}
				<div
					className="w-5 h-5 rounded-full border-2 border-white shadow-sm flex-shrink-0"
					style={{ backgroundColor: color }}
				/>

				{/* Name + First indicator grouped together */}
				<div className="flex-1 flex items-center justify-center gap-1.5">
					<span className="text-lg font-bold text-gray-800">{name}</span>
					{isSelected && (
						<svg
							className="w-5 h-5 flex-shrink-0"
							fill={color}
							viewBox="0 0 20 20"
						>
							<title>Goes First</title>
							<path
								fillRule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
								clipRule="evenodd"
							/>
						</svg>
					)}
				</div>

				{/* Edit icon - far right with separator */}
				<div className="border-l border-gray-300 pl-2 ml-2">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							if (!otherIsEditing) {
								handleNameClick(playerId);
							}
						}}
						disabled={otherIsEditing}
						className={`p-1 rounded transition-opacity flex-shrink-0 ${otherIsEditing ? "opacity-30 cursor-not-allowed" : "hover:opacity-70 cursor-pointer"}`}
						title="Edit player"
					>
						<svg
							className="w-4 h-4"
							fill="currentColor"
							viewBox="0 0 20 20"
							style={{ color }}
						>
							<title>Edit</title>
							<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
						</svg>
					</button>
				</div>
			</button>
		);
	};

	return (
		<div className="space-y-4">
			{/* Compact player selection row */}
			<div className="flex items-center gap-2">
				<PlayerChip
					playerId={1}
					isSelected={selectedPlayer === 1}
					otherIsEditing={editingPlayer === 2}
				/>

				{/* Swap button */}
				<button
					type="button"
					onClick={handleSwapPlayers}
					disabled={editingPlayer !== null}
					className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
					title="Swap players"
				>
					<svg
						className="w-5 h-5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<title>Swap</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
						/>
					</svg>
				</button>

				<PlayerChip
					playerId={2}
					isSelected={selectedPlayer === 2}
					otherIsEditing={editingPlayer === 1}
				/>
			</div>

			{/* Who Goes First indicator */}
			{!editingPlayer && (
				<div className="text-center py-2">
					<p className="text-sm text-gray-600 mb-1">Who Goes First?</p>
					<p className="text-base font-semibold text-gray-800">
						{tempNames[selectedPlayer]} goes first
					</p>
				</div>
			)}

			{/* Editing panel - shown below when editing */}
			{editingPlayer && (
				<div
					className="relative p-4 rounded-xl border-2 transition-all duration-300"
					style={{
						borderColor: tempColors[editingPlayer],
						backgroundColor: `${tempColors[editingPlayer]}10`,
					}}
				>
					<div className="space-y-3">
						{/* Header */}
						<div className="flex items-center justify-between">
							<span className="text-sm font-semibold text-gray-700">
								Editing {editingPlayer === 1 ? "Player 1" : "Player 2"}
							</span>
						</div>

						{/* Name Picker */}
						<PlayerNamePicker
							currentName={tempNames[editingPlayer]}
							playerColor={tempColors[editingPlayer]}
							onSelect={(name) => {
								handleNameChange(editingPlayer, name);
								// Don't close panel - let user also change color if desired
							}}
							onCancel={handleNameCancel}
							hideActionButtons={true}
						/>

						{/* Color Picker - compact inline */}
						<div className="flex items-center gap-2 pt-2 border-t border-gray-200">
							<span className="text-xs text-gray-500 flex-shrink-0">
								Color:
							</span>
							<div className="flex flex-wrap gap-1.5">
								{colorOptions.map((color) => (
									<button
										key={color}
										type="button"
										onClick={() => handleColorChange(editingPlayer, color)}
										className={`w-6 h-6 rounded-full border-2 transition-all ${
											tempColors[editingPlayer] === color
												? "border-gray-800 scale-110"
												: "border-gray-300 hover:scale-110"
										}`}
										style={{ backgroundColor: color }}
										title={color}
									/>
								))}
								<input
									type="color"
									value={tempColors[editingPlayer]}
									onChange={(e) =>
										handleColorChange(editingPlayer, e.target.value)
									}
									className="w-6 h-6 rounded-full border-2 border-gray-300 cursor-pointer"
									title="Custom color"
								/>
							</div>
						</div>

						{/* Action buttons */}
						<div className="flex gap-3 pt-3 border-t border-gray-200">
							<button
								type="button"
								onClick={handleNameCancel}
								className="flex-1 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => setEditingPlayer(null)}
								className="flex-1 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold transition-colors"
							>
								Done
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Start Game button */}
			<button
				type="button"
				onClick={handleStart}
				disabled={editingPlayer !== null}
				className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 text-lg shadow-lg hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
			>
				🎮 Start Game
			</button>
		</div>
	);
};
