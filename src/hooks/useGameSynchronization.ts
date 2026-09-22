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
import { isNewerState, sameOnlineState } from "../services/sync/stateProtocol";

interface Options {
	isOnlineMode: boolean;
	syncAdapter?: ISyncAdapter;
	roomCode?: string;
	localPlayerSlot?: number;
	localUserId?: string | null;
	onlineReady: boolean;
	gameState: GameState;
	initialGameState: GameState;
	setGameState: (state: GameState) => void;
	matchCheckTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
	isCheckingMatchRef: RefObject<boolean>;
}
function createWriteSession() {
	return {
		active: true,
		pending: new Set<Promise<void>>(),
		proposed: new Map<number, OnlineGameState>(),
		confirmed: null as OnlineGameState | null,
		recoveryRequired: false,
		recovery: null as Promise<void> | null,
	};
}

export function useGameSynchronization({
	isOnlineMode,
	syncAdapter,
	roomCode,
	localPlayerSlot,
	localUserId,
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
	const generation = useRef(0);
	const sessionRef = useRef(createWriteSession());
	const readyRef = useRef(onlineReady);
	readyRef.current = onlineReady;
	const previousIdentity = useRef({
		roomCode,
		syncAdapter,
		localPlayerSlot,
		localUserId,
		isOnlineMode,
	});
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
		sessionRef.current.active = false;
		sessionRef.current = createWriteSession();
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
	const confirm = useCallback((state: OnlineGameState) => {
		const session = sessionRef.current;
		if (!session.confirmed || isNewerState(state, session.confirmed))
			session.confirmed = state;
		lastSyncedVersionRef.current = Math.max(
			lastSyncedVersionRef.current,
			state.syncVersion,
		);
		for (const version of session.proposed.keys()) {
			if (version <= state.syncVersion) session.proposed.delete(version);
		}
	}, []);
	const accept = useCallback(
		(state: OnlineGameState) => {
			cancelResolution();
			lastGameRoundRef.current = state.gameRound;
			lastSyncedVersionRef.current = state.syncVersion;
			localVersionRef.current = state.syncVersion;
			confirm(state);
			stateApplied(state, "remote");
			setGameState(state);
		},
		[cancelResolution, confirm, setGameState],
	);
	// Called when start/replay installs its transaction's committed state, or the
	// controller explicitly returns to setup. Old round promises stay observed.
	const replaceRevision = useCallback(
		(state: GameState) => {
			invalidateSession();
			const revision = state as Partial<OnlineGameState>;
			lastGameRoundRef.current = revision.gameRound ?? 0;
			lastSyncedVersionRef.current = revision.syncVersion ?? 0;
			localVersionRef.current = lastSyncedVersionRef.current;
			pausedRef.current = false;
			setSyncError(null);
		},
		[invalidateSession],
	);
	const resynchronize = useCallback((): Promise<void> => {
		if (!isOnlineMode || !syncAdapter || !roomCode) return Promise.resolve();
		const session = sessionRef.current;
		if (session.recovery) return session.recovery;
		session.recoveryRequired = true;
		pausedRef.current = true;
		pauseTrace(trace, "resync");
		track("mm.sync.resync", { phase: "start", inflight: session.pending.size });
		++generation.current;
		epochBump(trace, generation.current, "resync");
		cancelResolution();
		const recovery = (async () => {
			try {
				// These promises absorb each rejection after observing it. Do not read
				// early: even a later proposal may still commit after another writer.
				await Promise.all([...session.pending]);
				if (!session.active) return;
				track("mm.sync.resync", {
					phase: "read",
					inflight: session.pending.size,
				});
				const response =
					(await syncAdapter.getState()) as OnlineGameState | null;
				if (!session.active) {
					track("mm.sync.resync", { phase: "stale" });
					return;
				}
				if (!response) throw new Error("Game is unavailable");
				// A listener may see a later server revision while the read is in flight.
				const state =
					session.confirmed && isNewerState(session.confirmed, response)
						? session.confirmed
						: response;
				accept(state);
				session.proposed.clear();
				session.recoveryRequired = false;
				if (readyRef.current) {
					setSyncError(null);
					pausedRef.current = false;
					resumeTrace(trace, "resync");
				}
				track("mm.sync.resync", { phase: "resolved" });
			} catch (error) {
				track("mm.sync.resync", {
					phase: "rejected",
					error_code: errorCode(error),
				});
				if (session.active)
					setSyncError(
						error instanceof Error ? error.message : "Synchronization failed",
					);
			} finally {
				session.recovery = null;
			}
		})();
		session.recovery = recovery;
		return recovery;
	}, [isOnlineMode, syncAdapter, roomCode, accept, cancelResolution, trace]);
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
			const session = sessionRef.current;
			const onlineState: OnlineGameState = {
				...state,
				syncVersion: ++localVersionRef.current,
				lastUpdatedBy: localPlayerSlot,
				gameRound: lastGameRoundRef.current,
			};
			session.proposed.set(onlineState.syncVersion, onlineState);
			const write = writeEnqueued(
				trace,
				onlineState,
				context,
				generation.current,
			);
			// Preserve timing joins; dequeue happens in this same input task. There is
			// no application queue and no acknowledgement barrier between submissions.
			writeDequeued(trace, write);
			let operation: Promise<void>;
			try {
				operation = syncAdapter.setState(onlineState);
			} catch (error) {
				operation = Promise.reject(error);
			}
			const settled = Promise.resolve(operation).then(
				() => {
					session.pending.delete(settled);
					track("mm.sync.write.inflight", {
						...write.fields,
						write_id: write.id,
						phase: "committed",
						inflight: session.pending.size,
					});
					if (
						session.active &&
						onlineState.gameRound === lastGameRoundRef.current
					)
						confirm(onlineState);
				},
				(error: unknown) => {
					session.pending.delete(settled);
					track("mm.sync.write.inflight", {
						...write.fields,
						write_id: write.id,
						phase: "rejected",
						inflight: session.pending.size,
						error_code: errorCode(error),
					});
					if (session.active && !session.recoveryRequired) {
						pause(
							error instanceof Error ? error.message : "Synchronization failed",
						);
						void resynchronize();
					}
				},
			);
			session.pending.add(settled);
			track("mm.sync.write.inflight", {
				...write.fields,
				write_id: write.id,
				phase: "submitted",
				inflight: session.pending.size,
			});
		},
		[
			isOnlineMode,
			syncAdapter,
			localPlayerSlot,
			pause,
			resynchronize,
			confirm,
			trace,
		],
	);

	useEffect(() => {
		const previous = previousIdentity.current;
		if (
			previous.roomCode !== roomCode ||
			previous.syncAdapter !== syncAdapter ||
			previous.localPlayerSlot !== localPlayerSlot ||
			previous.localUserId !== localUserId ||
			previous.isOnlineMode !== isOnlineMode
		) {
			lastSyncedVersionRef.current = 0;
			localVersionRef.current = 0;
			lastGameRoundRef.current = 0;
		}
		previousIdentity.current = {
			roomCode,
			syncAdapter,
			localPlayerSlot,
			localUserId,
			isOnlineMode,
		};
		pausedRef.current = false;
		resumeTrace(trace, "room-effect");
		setSyncError(null);
		return invalidateSession;
	}, [
		roomCode,
		syncAdapter,
		localPlayerSlot,
		localUserId,
		isOnlineMode,
		invalidateSession,
		trace,
	]);
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
		let listening = true;
		const listener = listenerStart("hook", roomCode);
		const stop = syncAdapter.subscribeToState(
			(remoteState) => {
				if (!listening) return;
				const remote = remoteState as OnlineGameState;
				const session = sessionRef.current;
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
				if (!newRound && session.recoveryRequired) {
					snapshotGate(
						remote,
						"recovering",
						lastGameRoundRef.current,
						lastSyncedVersionRef.current,
					);
					if (!session.confirmed || isNewerState(remote, session.confirmed))
						session.confirmed = remote;
					return;
				}
				if (
					!newRound &&
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
				const expected = session.proposed.get(remote.syncVersion);
				if (!newRound && expected) {
					if (sameOnlineState(remote, expected)) {
						snapshotGate(
							remote,
							"self-echo",
							lastGameRoundRef.current,
							lastSyncedVersionRef.current,
						);
						confirm(remote);
					} else {
						snapshotGate(
							remote,
							"conflict",
							lastGameRoundRef.current,
							lastSyncedVersionRef.current,
						);
						session.confirmed = remote;
						pause("Game changed. Synchronizing confirmed state.");
						void resynchronize();
					}
					return;
				}
				snapshotGate(
					remote,
					"accepted",
					lastGameRoundRef.current,
					lastSyncedVersionRef.current,
				);
				if (newRound) invalidateSession();
				++generation.current;
				epochBump(trace, generation.current, "snapshot");
				accept(remote);
				if (onlineReady) {
					pausedRef.current = false;
					resumeTrace(trace, "snapshot");
					setSyncError(null);
				}
			},
			(error) => {
				if (!listening) return;
				track("mm.sync.resync", {
					phase: "listener-error",
					error_code: errorCode(error),
				});
				pause(error.message);
			},
		);
		return observedListener(
			() => {
				listening = false;
				stop();
			},
			listener,
			"hook",
			roomCode,
		);
	}, [
		isOnlineMode,
		syncAdapter,
		roomCode,
		localPlayerSlot,
		localUserId,
		onlineReady,
		accept,
		confirm,
		pause,
		resynchronize,
		invalidateSession,
		trace,
	]);
	return {
		telemetryTrace: trace,
		syncError,
		resynchronize,
		syncToFirestore,
		replaceRevision,
		pausedRef,
		generation,
		lastSyncedVersionRef,
		localVersionRef,
		lastGameRoundRef,
	};
}
