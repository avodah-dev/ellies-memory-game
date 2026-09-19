/**
 * OnlineLobby - Main container for online multiplayer flow
 *
 * Handles the flow: Connect -> Create/Join -> Wait -> Start
 */

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LogIn, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_DECKS } from "../../data/cardDecks";
import {
	createInitialState,
	initializeCards,
	shuffleCards,
	startGameWithCards,
} from "../../services/game/GameEngine";
import { getFirestoreSyncAdapter } from "../../services/sync/FirestoreSyncAdapter";
import { useOnlineStore, useSettingsStore } from "../../stores";
import type { CardPack, OnlineGameState } from "../../types";
import { DEFAULT_PAIR_COUNT } from "../../utils/gridLayout";
import { ConnectionStatus } from "./ConnectionStatus";
import { JoinRoomForm } from "./JoinRoomForm";
import { RoomCodeDisplay } from "./RoomCodeDisplay";
import { WaitingRoom } from "./WaitingRoom";

type LobbyView = "choice" | "create" | "join" | "waiting";

interface OnlineLobbyProps {
	onBack: () => void;
	onGameStart: (gameState: import("../../types").GameState) => void;
}

export const OnlineLobby = ({ onBack, onGameStart }: OnlineLobbyProps) => {
	const navigate = useNavigate();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	// Derive view from current route
	const view: LobbyView =
		currentPath === "/online/create"
			? "create"
			: currentPath === "/online/join"
				? "join"
				: currentPath === "/online/waiting"
					? "waiting"
					: "choice";

	const [isLoading, setIsLoading] = useState(false);
	const [isStarting, setIsStarting] = useState(false);
	const [startedState, setStartedState] = useState<OnlineGameState | null>(
		null,
	);
	const startingRef = useRef(false);
	const activeLobby = useRef(true);
	const hasStartedGame = useRef(false);
	const [playerNameInput, setPlayerNameInput] = useState("");

	const {
		connectionStatus,
		roomCode,
		room,
		isHost,
		opponentConnected,
		error,
		connect,
		createRoom,
		joinRoom,
		leaveRoom,
		subscribeToPresence,
		clearError,
		setError,
		playerName,
		setPlayerNamePreference,
		getLastOnlinePreferences,
		presenceData,
	} = useOnlineStore();

	useEffect(() => {
		setPlayerNameInput(playerName);
	}, [playerName]);

	const { settings } = useSettingsStore();
	useEffect(() => {
		activeLobby.current = true;
		return () => {
			activeLobby.current = false;
		};
	}, []);

	// Helper to get images for a card pack
	const getPackImages = useCallback((packId: CardPack) => {
		const deck = CARD_DECKS.find((d) => d.id === packId) || CARD_DECKS[0];
		return deck.cards.map((card) => ({
			id: card.id,
			url: card.imageUrl || card.emoji,
			gradient: card.gradient,
		}));
	}, []);

	// Handle starting the game (host only)
	const handleStartGame = useCallback(async () => {
		if (
			!isHost ||
			!room ||
			!roomCode ||
			startingRef.current ||
			startedState ||
			hasStartedGame.current
		)
			return;
		startingRef.current = true;
		setIsStarting(true);
		clearError();

		try {
			// Get card images for the selected pack
			const cardPack = room.config?.cardPack || settings.cardPack;
			const pairCount =
				room.config?.pairCount ??
				settings.onlinePairCount ??
				DEFAULT_PAIR_COUNT;

			// Get all images then randomly select subset based on pair count
			const allImages = getPackImages(cardPack);
			const shuffled = shuffleCards(allImages);
			const images = shuffled.slice(0, pairCount);

			// Create initial game state from presence data
			const players = Object.values(presenceData);
			const hostPlayer = players.find((p) => p.slot === 1);
			const guestPlayer = players.find((p) => p.slot === 2);

			if (!hostPlayer || !guestPlayer) {
				throw new Error(
					"Both players must be present before starting the game",
				);
			}

			// Initialize cards
			const cards = initializeCards(images);

			// Create game state - player info is stored in presence data, not game state
			const initialState = createInitialState(1); // Host goes first

			const gameState = startGameWithCards(initialState, cards);

			// Create complete online state with sync metadata
			// This ensures the host's useOnlineGame hook initializes with correct gameRound
			const onlineState: OnlineGameState = {
				...gameState,
				syncVersion: 1,
				gameRound: 1, // First round
				lastUpdatedBy: 1, // Host is always slot 1
			};

			// Start game via adapter (syncs to Firestore)
			const adapter = getFirestoreSyncAdapter();
			const confirmed = await adapter.startGame(roomCode, onlineState);
			if (
				activeLobby.current &&
				useOnlineStore.getState().roomCode === roomCode
			) {
				setStartedState(confirmed);
			}
		} catch (error) {
			if (
				activeLobby.current &&
				useOnlineStore.getState().roomCode === roomCode
			)
				setError(
					error instanceof Error ? error.message : "Failed to start game",
				);
		} finally {
			startingRef.current = false;
			if (activeLobby.current) setIsStarting(false);
		}
	}, [
		isHost,
		room,
		roomCode,
		settings.cardPack,
		getPackImages,
		startedState,
		presenceData,
		settings.onlinePairCount,
		clearError,
		setError,
	]);

	// The transaction response and room listener can arrive in either order.
	// Navigate only after both agree, so the game's waiting-room guard cannot
	// send the host back while its room snapshot still says "waiting".
	useEffect(() => {
		if (
			isHost &&
			startedState &&
			room?.status === "playing" &&
			!hasStartedGame.current
		) {
			hasStartedGame.current = true;
			onGameStart(startedState);
		}
	}, [isHost, startedState, room?.status, onGameStart]);

	// Connect on mount
	useEffect(() => {
		if (connectionStatus === "disconnected") {
			connect().catch(console.error);
		}
	}, [connectionStatus, connect]);

	// Subscribe to room and presence when in a room
	useEffect(() => {
		if (!roomCode) return;

		const unsubPresence = subscribeToPresence(roomCode);
		return () => {
			unsubPresence();
		};
	}, [roomCode, subscribeToPresence]);

	// Move to waiting view when room is created/joined
	useEffect(() => {
		if (
			roomCode &&
			(view === "create" || view === "join") &&
			currentPath !== "/online/waiting"
		) {
			navigate({ to: "/online/waiting" });
			setIsLoading(false);
		}
	}, [roomCode, view, currentPath, navigate]);

	// Guests wait for the confirmed game document. The room notification can
	// arrive before the game listener catches up; an immediate read can be stale.
	useEffect(() => {
		if (
			isHost ||
			!roomCode ||
			room?.status !== "playing" ||
			hasStartedGame.current
		)
			return;
		let active = true;
		const stop = getFirestoreSyncAdapter().subscribeToState(
			(gameState) => {
				if (!active || hasStartedGame.current) return;
				hasStartedGame.current = true;
				onGameStart(gameState);
			},
			(error) => {
				if (active) setError(error.message);
			},
		);
		return () => {
			active = false;
			stop();
		};
	}, [room?.status, roomCode, isHost, onGameStart, setError]);

	const handleCreateRoom = async () => {
		setIsLoading(true);
		clearError();

		try {
			const preferredName = playerNameInput.trim() || "Player";
			setPlayerNamePreference(preferredName);

			// Get stored online preferences, fall back to local game settings
			const storedPrefs = getLastOnlinePreferences();
			await createRoom({
				hostName: preferredName,
				hostColor: settings.player1Color,
				cardPack: (storedPrefs.cardPack as CardPack) || settings.cardPack,
				background: storedPrefs.background || settings.background,
				cardBack: storedPrefs.cardBack || settings.cardBack,
				pairCount: settings.onlinePairCount,
			});
		} catch {
			setIsLoading(false);
		}
	};

	const handleJoinRoom = async (code: string) => {
		setIsLoading(true);
		clearError();

		try {
			const preferredName = playerNameInput.trim() || "Player";
			setPlayerNamePreference(preferredName);
			await joinRoom(code, preferredName, settings.player1Color);
		} catch {
			setIsLoading(false);
		}
	};

	const handleLeaveRoom = async () => {
		await leaveRoom();
		navigate({ to: "/online" });
	};

	const handleBack = () => {
		if (view === "waiting") {
			handleLeaveRoom();
		} else if (view === "choice") {
			onBack();
		} else {
			navigate({ to: "/online" });
			clearError();
		}
	};

	// Render based on current view
	const renderContent = () => {
		// Still connecting
		if (connectionStatus === "connecting") {
			return (
				<div className="text-center space-y-6 py-8">
					<div className="text-6xl animate-bounce">{"connect"}</div>
					<p className="text-gray-600">Connecting to server...</p>
				</div>
			);
		}

		// Connection failed
		if (connectionStatus === "disconnected" && error) {
			return (
				<div className="text-center space-y-6 py-8">
					<div className="text-6xl">{"err"}</div>
					<p className="text-red-600 font-medium">{error}</p>
					<button
						type="button"
						onClick={() => connect()}
						className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
					>
						Retry Connection
					</button>
				</div>
			);
		}

		switch (view) {
			case "choice":
				return (
					<div className="text-center space-y-8">
						<div>
							<h2 className="text-2xl font-bold text-gray-800 mb-2">
								Online Multiplayer
							</h2>
							<p className="text-gray-600">
								Create a room or join an existing one
							</p>
						</div>

						<div className="max-w-sm mx-auto w-full text-left space-y-2">
							<label
								className="text-sm font-semibold text-gray-700"
								htmlFor="online-name-input"
							>
								Your online name
							</label>
							{/** biome-ignore lint/correctness/useUniqueElementIds: Opus says this is fine */}
							<input
								id="online-name-input"
								type="text"
								value={playerNameInput}
								onChange={(e) => setPlayerNameInput(e.target.value)}
								onBlur={() => setPlayerNamePreference(playerNameInput)}
								maxLength={20}
								className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
								placeholder="Enter your name"
								disabled={isLoading}
							/>
							<p className="text-xs text-gray-500">
								This name is shared when you create or join rooms.
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-xl mx-auto">
							<button
								type="button"
								onClick={() => {
									navigate({ to: "/online/create" });
									handleCreateRoom();
								}}
								disabled={isLoading}
								className="p-8 rounded-xl border-3 border-gray-200 bg-white hover:border-blue-400 hover:shadow-lg transition-all duration-300 transform hover:scale-105 group disabled:opacity-50"
							>
								<div className="space-y-4">
									<div className="flex justify-center">
										<UserPlus className="w-14 h-14 text-blue-500 transition-transform group-hover:scale-110" />
									</div>
									<h3 className="text-xl font-bold text-gray-800">
										Create Room
									</h3>
									<p className="text-gray-600 text-sm">
										Start a new game and invite a friend
									</p>
								</div>
							</button>

							<button
								type="button"
								onClick={() => navigate({ to: "/online/join" })}
								disabled={isLoading}
								className="p-8 rounded-xl border-3 border-gray-200 bg-white hover:border-purple-400 hover:shadow-lg transition-all duration-300 transform hover:scale-105 group disabled:opacity-50"
							>
								<div className="space-y-4">
									<div className="flex justify-center">
										<LogIn className="w-14 h-14 text-purple-500 transition-transform group-hover:scale-110" />
									</div>
									<h3 className="text-xl font-bold text-gray-800">Join Room</h3>
									<p className="text-gray-600 text-sm">
										Enter a code to join your friend's game
									</p>
								</div>
							</button>
						</div>

						<button
							type="button"
							onClick={onBack}
							className="text-gray-500 hover:text-gray-700 font-medium"
						>
							Back to Mode Selection
						</button>
					</div>
				);

			case "create":
				return (
					<div className="text-center space-y-6 py-8">
						<div className="text-6xl animate-pulse">{"..."}</div>
						<p className="text-gray-600">Creating room...</p>
					</div>
				);

			case "join":
				return (
					<JoinRoomForm
						onJoin={handleJoinRoom}
						onBack={handleBack}
						isLoading={isLoading}
						error={error}
					/>
				);

			case "waiting":
				return roomCode && room ? (
					<WaitingRoom
						roomCode={roomCode}
						room={room}
						isHost={isHost}
						opponentConnected={opponentConnected}
						onLeave={handleLeaveRoom}
						onStartGame={handleStartGame}
						isStarting={isStarting || startedState !== null}
					/>
				) : null;

			default:
				return null;
		}
	};

	return (
		<div className="max-w-2xl mx-auto">
			{/* Connection Status - fixed top left, aligned with reload button */}
			<div className="fixed top-5 left-[3.75rem] z-10 flex items-center">
				<div className="px-2 py-2">
					<ConnectionStatus status={connectionStatus} />
				</div>
			</div>

			{/* Room Code (when in room) */}
			{roomCode && view === "waiting" && (
				<div className="mb-6">
					<RoomCodeDisplay roomCode={roomCode} />
				</div>
			)}

			{/* Main Content */}
			<div className="bg-white rounded-xl shadow-lg p-8">{renderContent()}</div>
		</div>
	);
};
