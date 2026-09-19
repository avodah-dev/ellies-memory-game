import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOnlineStore } from "../../stores";
import {
	createTestOnlineGameState,
	createTestRoom,
	createTestPresenceData,
} from "../../test/testUtils";
import type { GameState } from "../../types";
import { OnlineLobby } from "./OnlineLobby";

const adapter = vi.hoisted(() => ({
	startGame: vi.fn(),
	getState: vi.fn(),
	subscribeToState: vi.fn(),
}));
vi.mock("../../services/sync/FirestoreSyncAdapter", () => ({
	getFirestoreSyncAdapter: () => adapter,
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouterState: () => ({ location: { pathname: "/online/waiting" } }),
}));
vi.mock("../../stores", async () => {
	const { create } = await import("zustand");
	return {
		useOnlineStore: create(() => ({})),
		useSettingsStore: () => ({
			settings: { cardPack: "animals", onlinePairCount: 4 },
		}),
	};
});
vi.mock("./WaitingRoom", () => ({
	WaitingRoom: ({
		onStartGame,
		isStarting,
	}: {
		onStartGame: () => void;
		isStarting: boolean;
	}) => (
		<button disabled={isStarting} onClick={onStartGame}>
			Start Game
		</button>
	),
}));

let deliver: (state: GameState) => void;
const unsubscribe = vi.fn();
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	vi.clearAllMocks();
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	adapter.getState.mockResolvedValue(null); // The game listener has not delivered the new document yet.
	adapter.subscribeToState.mockImplementation((callback) => {
		deliver = callback;
		return unsubscribe;
	});
	useOnlineStore.setState({
		connectionStatus: "connected",
		roomCode: "ABCD",
		room: createTestRoom({ roomCode: "ABCD" }),
		isHost: true,
		opponentConnected: true,
		error: null,
		playerName: "Host",
		presenceData: {
			host: createTestPresenceData({ odahId: "host", slot: 1 }),
			guest: createTestPresenceData({ odahId: "guest", slot: 2 }),
		},
		subscribeToPresence: vi.fn(() => vi.fn()),
		setError: (error) => useOnlineStore.setState({ error }),
		clearError: () => useOnlineStore.setState({ error: null }),
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("starts the host once from the committed transaction even when the game read is behind", async () => {
	const confirmed = createTestOnlineGameState({ gameRound: 3, syncVersion: 1 });
	let commit!: (state: GameState) => void;
	adapter.startGame.mockReturnValue(
		new Promise<GameState>((resolve) => {
			commit = resolve;
		}),
	);
	const onGameStart = vi.fn();
	render(<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	act(() =>
		useOnlineStore.setState({ room: createTestRoom({ status: "playing" }) }),
	);
	expect(onGameStart).not.toHaveBeenCalled();
	await act(async () => commit(confirmed));
	await waitFor(() =>
		expect(onGameStart).toHaveBeenCalledExactlyOnceWith(confirmed),
	);
	expect(adapter.startGame).toHaveBeenCalledTimes(1);
	expect(adapter.getState).not.toHaveBeenCalled();
	expect(consoleError).not.toHaveBeenCalled();
});

it("waits for a confirmed game snapshot before starting the guest", async () => {
	useOnlineStore.setState({
		isHost: false,
		room: createTestRoom({ status: "playing" }),
	});
	const onGameStart = vi.fn();
	const view = render(
		<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />,
	);
	expect(onGameStart).not.toHaveBeenCalled();
	const confirmed = createTestOnlineGameState({ gameRound: 2 });
	act(() => deliver(confirmed));
	act(() => deliver(confirmed));
	expect(onGameStart).toHaveBeenCalledExactlyOnceWith(confirmed);
	expect(adapter.getState).not.toHaveBeenCalled();
	view.unmount();
	expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it("waits for the playing room notification when the start transaction resolves first", async () => {
	const confirmed = createTestOnlineGameState();
	adapter.startGame.mockResolvedValue(confirmed);
	const onGameStart = vi.fn();
	render(<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />);
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Start Game" })),
	);
	expect(onGameStart).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Start Game" })).toBeDisabled();
	act(() =>
		useOnlineStore.setState({ room: createTestRoom({ status: "playing" }) }),
	);
	expect(onGameStart).toHaveBeenCalledExactlyOnceWith(confirmed);
});

it("keeps a rejected start in the lobby and publishes the failure for the app's error banner", async () => {
	adapter.startGame.mockRejectedValue(new Error("Permission denied"));
	const onGameStart = vi.fn();
	render(<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	await waitFor(() =>
		expect(useOnlineStore.getState().error).toBe("Permission denied"),
	);
	expect(onGameStart).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Start Game" })).toBeEnabled();
	const confirmed = createTestOnlineGameState();
	adapter.startGame.mockResolvedValue(confirmed);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	act(() =>
		useOnlineStore.setState({ room: createTestRoom({ status: "playing" }) }),
	);
	await waitFor(() =>
		expect(onGameStart).toHaveBeenCalledExactlyOnceWith(confirmed),
	);
	expect(useOnlineStore.getState().error).toBeNull();
});

it("does not navigate from a start that completes after leaving the lobby", async () => {
	const confirmed = createTestOnlineGameState();
	adapter.getState.mockResolvedValue(confirmed);
	let commit!: (state: GameState) => void;
	adapter.startGame.mockReturnValue(
		new Promise<GameState>((resolve) => {
			commit = resolve;
		}),
	);
	const onGameStart = vi.fn();
	const view = render(
		<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />,
	);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	view.unmount();
	await act(async () => commit(confirmed));
	expect(onGameStart).not.toHaveBeenCalled();
});

it("ignores a late guest snapshot after unsubscribing from the lobby", () => {
	useOnlineStore.setState({
		isHost: false,
		room: createTestRoom({ status: "playing" }),
	});
	const onGameStart = vi.fn();
	const view = render(
		<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />,
	);
	view.unmount();
	act(() => deliver(createTestOnlineGameState()));
	expect(onGameStart).not.toHaveBeenCalled();
	expect(unsubscribe).toHaveBeenCalledTimes(1);
});
