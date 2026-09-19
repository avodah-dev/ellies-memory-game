import {
	useState,
	useRef,
	useCallback,
	useEffect,
	type RefObject,
} from "react";
import type { GameState, OnlineGameState } from "../types";
import type { ISyncAdapter } from "../services/sync/ISyncAdapter";
import { isNewerState } from "../services/sync/stateProtocol";

interface Options {
	isOnlineMode: boolean;
	syncAdapter?: ISyncAdapter;
	roomCode?: string;
	localPlayerSlot?: number;
	onlineReady: boolean;
	gameState: GameState;
	initialGameState: GameState;
	setGameState: (state: GameState) => void;
	matchCheckTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
	isCheckingMatchRef: RefObject<boolean>;
}

export function useGameSynchronization({
	isOnlineMode,
	syncAdapter,
	roomCode,
	localPlayerSlot,
	onlineReady,
	gameState,
	initialGameState,
	setGameState,
	matchCheckTimeoutRef,
	isCheckingMatchRef,
}: Options) {
	const [syncError, setSyncError] = useState<string | null>(null);
	const pausedRef = useRef(false);
	const writeQueue = useRef(Promise.resolve());
	const generation = useRef(0);
	const previousRoom = useRef(roomCode);
	const initialRevision = initialGameState as Partial<OnlineGameState>;
	const lastSyncedVersionRef = useRef(initialRevision.syncVersion ?? 0);
	const localVersionRef = useRef(initialRevision.syncVersion ?? 0);
	const lastGameRoundRef = useRef(initialRevision.gameRound ?? 0);
	const cancelResolution = useCallback(() => {
		if (matchCheckTimeoutRef.current)
			clearTimeout(matchCheckTimeoutRef.current);
		matchCheckTimeoutRef.current = null;
		isCheckingMatchRef.current = false;
	}, [matchCheckTimeoutRef, isCheckingMatchRef]);
	const invalidateSession = useCallback(() => {
		++generation.current;
		cancelResolution();
	}, [cancelResolution]);
	const pause = useCallback(
		(message: string) => {
			pausedRef.current = true;
			++generation.current;
			cancelResolution();
			setSyncError(message);
		},
		[cancelResolution],
	);
	const accept = useCallback(
		(state: OnlineGameState) => {
			cancelResolution();
			lastSyncedVersionRef.current = state.syncVersion;
			localVersionRef.current = state.syncVersion;
			lastGameRoundRef.current = state.gameRound;
			setGameState(state);
		},
		[cancelResolution, setGameState],
	);
	const resynchronize = useCallback(async () => {
		if (!syncAdapter || !roomCode) return;
		pausedRef.current = true;
		const epoch = ++generation.current;
		cancelResolution();
		try {
			const state = (await syncAdapter.getState()) as OnlineGameState | null;
			if (epoch !== generation.current) return;
			if (!state) throw new Error("Game is unavailable");
			accept(state);
			setSyncError(null);
			pausedRef.current = false;
		} catch (error) {
			if (epoch === generation.current)
				setSyncError(
					error instanceof Error ? error.message : "Synchronization failed",
				);
		}
	}, [syncAdapter, roomCode, accept, cancelResolution]);
	const syncToFirestore = useCallback(
		(state: GameState, _context?: string) => {
			if (!isOnlineMode || !syncAdapter || pausedRef.current) return;
			const epoch = generation.current;
			const onlineState: OnlineGameState = {
				...state,
				syncVersion: ++localVersionRef.current,
				lastUpdatedBy: localPlayerSlot,
				gameRound: lastGameRoundRef.current,
			};
			writeQueue.current = writeQueue.current.then(async () => {
				if (epoch !== generation.current || pausedRef.current) return;
				try {
					await syncAdapter.setState(onlineState);
				} catch (error) {
					if (epoch === generation.current)
						pause(
							error instanceof Error ? error.message : "Synchronization failed",
						);
				}
			});
		},
		[isOnlineMode, syncAdapter, localPlayerSlot, pause],
	);

	// A different room is a different synchronization session. Old promises cannot
	// update the new session, and its first snapshot must not inherit old revisions.
	useEffect(() => {
		if (previousRoom.current !== roomCode) {
			lastSyncedVersionRef.current = 0;
			localVersionRef.current = 0;
			lastGameRoundRef.current = 0;
			previousRoom.current = roomCode;
		}
		pausedRef.current = false;
		setSyncError(null);
		return invalidateSession;
	}, [roomCode, invalidateSession]);
	useEffect(() => {
		if (!isOnlineMode || !roomCode || gameState.gameStatus === "setup") return;
		if (!onlineReady) pause("Connection interrupted. Game paused.");
		else if (pausedRef.current) void resynchronize();
	}, [
		isOnlineMode,
		roomCode,
		onlineReady,
		resynchronize,
		gameState.gameStatus,
		pause,
	]);
	useEffect(() => {
		if (
			!isOnlineMode ||
			!syncAdapter ||
			!roomCode ||
			(localPlayerSlot !== 1 && localPlayerSlot !== 2)
		)
			return;
		return syncAdapter.subscribeToState(
			(remoteState) => {
				const remote = remoteState as OnlineGameState;
				if (remote.gameRound < lastGameRoundRef.current) return;
				const newRound = remote.gameRound > lastGameRoundRef.current;
				// Confirm our own queued writes without rolling back later optimistic moves.
				// A revision beyond our queue can come from another tab using the same UID.
				if (
					!newRound &&
					remote.lastUpdatedBy === localPlayerSlot &&
					remote.syncVersion <= localVersionRef.current
				) {
					lastSyncedVersionRef.current = Math.max(
						lastSyncedVersionRef.current,
						remote.syncVersion,
					);
					return;
				}
				if (
					!isNewerState(remote, {
						gameRound: lastGameRoundRef.current,
						syncVersion: lastSyncedVersionRef.current,
					})
				)
					return;
				++generation.current;
				accept(remote);
				// A confirmed snapshot can win the race with the explicit server read.
				if (onlineReady) {
					pausedRef.current = false;
					setSyncError(null);
				}
			},
			(error) => pause(error.message),
		);
	}, [
		isOnlineMode,
		syncAdapter,
		roomCode,
		localPlayerSlot,
		onlineReady,
		accept,
		pause,
	]);
	return {
		syncError,
		resynchronize,
		syncToFirestore,
		pausedRef,
		generation,
		lastSyncedVersionRef,
		localVersionRef,
		lastGameRoundRef,
	};
}
