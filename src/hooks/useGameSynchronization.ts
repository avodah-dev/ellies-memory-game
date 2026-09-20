import { track } from "../services/telemetry/core";
import {
	createSyncTrace,
	cancelMatchTimer,
	epochBump,
	pauseTrace,
	resumeTrace,
	stateApplied,
	writeSkipped,
	writeEnqueued,
	writeDequeued,
	writeDropped,
	snapshotGate,
	errorCode,
} from "../services/telemetry/gameplay";
import {
	listenerStart,
	observedListener,
} from "../services/telemetry/syncObserver";
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
	const [trace] = useState(createSyncTrace);
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
		cancelMatchTimer(matchCheckTimeoutRef, "sync-resolution");
		if (matchCheckTimeoutRef.current)
			clearTimeout(matchCheckTimeoutRef.current);
		matchCheckTimeoutRef.current = null;
		isCheckingMatchRef.current = false;
	}, [matchCheckTimeoutRef, isCheckingMatchRef]);
	const invalidateSession = useCallback(() => {
		++generation.current;
		epochBump(trace, generation.current, "invalidate");
		cancelResolution();
	}, [cancelResolution, trace]);
	const pause = useCallback(
		(message: string) => {
			pausedRef.current = true;
			pauseTrace(trace, "sync-error-or-connection");
			++generation.current;
			epochBump(trace, generation.current, "pause");
			cancelResolution();
			setSyncError(message);
		},
		[cancelResolution, trace],
	);
	const accept = useCallback(
		(state: OnlineGameState) => {
			cancelResolution();
			lastSyncedVersionRef.current = state.syncVersion;
			localVersionRef.current = state.syncVersion;
			lastGameRoundRef.current = state.gameRound;
			stateApplied(state, "remote");
			setGameState(state);
		},
		[cancelResolution, setGameState],
	);
	const resynchronize = useCallback(async () => {
		if (!syncAdapter || !roomCode) return;
		pausedRef.current = true;
		pauseTrace(trace, "resync");
		track("mm.sync.resync", { phase: "start" });
		const epoch = ++generation.current;
		epochBump(trace, epoch, "resync");
		cancelResolution();
		try {
			const state = (await syncAdapter.getState()) as OnlineGameState | null;
			if (epoch !== generation.current) {
				track("mm.sync.resync", { phase: "stale" });
				return;
			}
			if (!state) throw new Error("Game is unavailable");
			accept(state);
			setSyncError(null);
			pausedRef.current = false;
			resumeTrace(trace, "resync");
			track("mm.sync.resync", { phase: "resolved" });
		} catch (error) {
			track("mm.sync.resync", {
				phase: "rejected",
				error_code: errorCode(error),
			});
			if (epoch === generation.current)
				setSyncError(
					error instanceof Error ? error.message : "Synchronization failed",
				);
		}
	}, [syncAdapter, roomCode, accept, cancelResolution, trace]);
	const syncToFirestore = useCallback(
		(state: GameState, context?: string) => {
			writeSkipped(
				isOnlineMode,
				syncAdapter,
				pausedRef.current,
				context,
				state,
			);
			if (!isOnlineMode || !syncAdapter || pausedRef.current) return;
			const epoch = generation.current;
			const onlineState: OnlineGameState = {
				...state,
				syncVersion: ++localVersionRef.current,
				lastUpdatedBy: localPlayerSlot,
				gameRound: lastGameRoundRef.current,
			};
			const write = writeEnqueued(trace, onlineState, context, epoch);
			writeQueue.current = writeQueue.current.then(async () => {
				if (epoch !== generation.current || pausedRef.current) {
					writeDropped(trace, write, generation.current, pausedRef.current);
					return;
				}
				writeDequeued(trace, write);
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
		[isOnlineMode, syncAdapter, localPlayerSlot, pause, trace],
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
		resumeTrace(trace, "room-effect");
		setSyncError(null);
		return invalidateSession;
	}, [roomCode, invalidateSession, trace]);
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
		const listener = listenerStart("hook", roomCode);
		const stop = syncAdapter.subscribeToState(
			(remoteState) => {
				const remote = remoteState as OnlineGameState;
				if (remote.gameRound < lastGameRoundRef.current) {
					snapshotGate(
						remote,
						"stale-round",
						lastGameRoundRef.current,
						lastSyncedVersionRef.current,
					);
					return;
				}
				const newRound = remote.gameRound > lastGameRoundRef.current;
				// Confirm our own queued writes without rolling back later optimistic moves.
				// A revision beyond our queue can come from another tab using the same UID.
				if (
					!newRound &&
					remote.lastUpdatedBy === localPlayerSlot &&
					remote.syncVersion <= localVersionRef.current
				) {
					snapshotGate(
						remote,
						"self-echo",
						lastGameRoundRef.current,
						lastSyncedVersionRef.current,
					);
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
				) {
					snapshotGate(
						remote,
						"not-newer",
						lastGameRoundRef.current,
						lastSyncedVersionRef.current,
					);
					return;
				}
				snapshotGate(
					remote,
					"accepted",
					lastGameRoundRef.current,
					lastSyncedVersionRef.current,
				);
				++generation.current;
				epochBump(trace, generation.current, "snapshot");
				accept(remote);
				// A confirmed snapshot can win the race with the explicit server read.
				if (onlineReady) {
					pausedRef.current = false;
					resumeTrace(trace, "snapshot");
					setSyncError(null);
				}
			},
			(error) => {
				track("mm.sync.resync", {
					phase: "listener-error",
					error_code: errorCode(error),
				});
				pause(error.message);
			},
		);
		return observedListener(stop, listener, "hook", roomCode);
	}, [
		isOnlineMode,
		syncAdapter,
		roomCode,
		localPlayerSlot,
		onlineReady,
		accept,
		pause,
		trace,
	]);
	return {
		telemetryTrace: trace,
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
