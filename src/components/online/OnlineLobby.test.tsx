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
const router = vi.hoisted(() => ({
	pathname: "/online/waiting",
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => router.navigate,
	useRouterState: () => ({ location: { pathname: router.pathname } }),
}));
vi.mock("../../stores", async () => {
	const { create } = await import("zustand");
	return {
		useOnlineStore: create(() => ({})),
		useSettingsStore: () => ({
			settings: {
				cardPack: "animals",
				onlinePairCount: 4,
				player1Color: "#3b82f6",
				background: "default",
				cardBack: "default",
			},
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
	router.pathname = "/online/waiting";
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	adapter.getState.mockResolvedValue(null); // The game listener has not delivered the new document yet.
	adapter.subscribeToState.mockImplementation((callback) => {
		deliver = callback;
		return unsubscribe;
	});
	useOnlineStore.setState({
		connectionStatus: "connected",
		isCreatingRoom: false,
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

it("resumes a round already in progress when the host rejoins with the code", () => {
	useOnlineStore.setState({
		isHost: true,
		room: createTestRoom({ status: "playing" }),
	});
	const onGameStart = vi.fn();
	render(<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />);
	expect(adapter.subscribeToState).toHaveBeenCalledOnce();
	const confirmed = createTestOnlineGameState({ gameRound: 4 });
	act(() => deliver(confirmed));
	expect(onGameStart).toHaveBeenCalledExactlyOnceWith(confirmed);
	expect(adapter.startGame).not.toHaveBeenCalled();
});

it("does not open a second game listener while the host's own start is committing", async () => {
	let commit!: (state: GameState) => void;
	adapter.startGame.mockReturnValue(
		new Promise<GameState>((resolve) => {
			commit = resolve;
		}),
	);
	const onGameStart = vi.fn();
	render(<OnlineLobby onBack={vi.fn()} onGameStart={onGameStart} />);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	act(() =>
		useOnlineStore.setState({ room: createTestRoom({ status: "playing" }) }),
	);
	const confirmed = createTestOnlineGameState();
	await act(async () => commit(confirmed));
	await waitFor(() =>
		expect(onGameStart).toHaveBeenCalledExactlyOnceWith(confirmed),
	);
	expect(adapter.subscribeToState).not.toHaveBeenCalled();
});

it("shows why room creation failed and retries from the same screen", async () => {
	router.pathname = "/online/create";
	const createRoom = vi.fn().mockImplementation(async () => {
		useOnlineStore.setState({ error: "Presence connection timeout" });
		throw new Error("Presence connection timeout");
	});
	useOnlineStore.setState({
		roomCode: null,
		room: null,
		isHost: false,
		error: "Presence connection timeout",
		createRoom,
		setPlayerNamePreference: vi.fn(),
		getLastOnlinePreferences: () => ({
			cardPack: null,
			background: null,
			cardBack: null,
		}),
	});
	render(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	expect(screen.getByRole("alert")).toHaveTextContent(
		"Presence connection timeout",
	);
	expect(screen.queryByText("Creating room...")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
	expect(createRoom).toHaveBeenCalledOnce();
	await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
	fireEvent.click(screen.getByRole("button", { name: "Back" }));
	expect(router.navigate).toHaveBeenCalledWith({
		to: "/online",
		replace: true,
	});
});

it("keeps showing the spinner when the create route mounts a fresh lobby mid-request", () => {
	// /online and /online/create mount separate lobby instances, so request
	// state must come from the store rather than the component.
	router.pathname = "/online/create";
	useOnlineStore.setState({
		roomCode: null,
		room: null,
		error: null,
		isCreatingRoom: true,
	});
	const view = render(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	expect(screen.getByText("Creating room...")).toBeInTheDocument();
	expect(view.container.querySelector("svg.animate-spin")).not.toBeNull();
	expect(screen.queryByText("...")).toBeNull();
	expect(router.navigate).not.toHaveBeenCalled();
	// A request that ends without an error or a room leaves nothing to show.
	act(() => useOnlineStore.setState({ isCreatingRoom: false }));
	expect(screen.queryByText("Creating room...")).toBeNull();
	expect(router.navigate).toHaveBeenCalledWith({
		to: "/online",
		replace: true,
	});
});

it("returns to the lobby when browser history lands on an idle create screen", () => {
	router.pathname = "/online/create";
	useOnlineStore.setState({ roomCode: null, room: null, error: null });
	render(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	expect(screen.queryByText("Creating room...")).toBeNull();
	expect(router.navigate).toHaveBeenCalledWith({
		to: "/online",
		replace: true,
	});
});

it("never starts from the waiting room while the room already has a round in progress", () => {
	useOnlineStore.setState({
		isHost: true,
		room: createTestRoom({ status: "playing" }),
	});
	render(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	expect(adapter.startGame).not.toHaveBeenCalled();
});

it("asks the transaction to require a waiting room for a lobby start", async () => {
	adapter.startGame.mockReturnValue(new Promise(() => {}));
	render(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	fireEvent.click(screen.getByRole("button", { name: "Start Game" }));
	await waitFor(() => expect(adapter.startGame).toHaveBeenCalledOnce());
	expect(adapter.startGame.mock.calls[0][2]).toEqual({
		requireStatus: "waiting",
	});
});

it("shows icons rather than placeholder words while connecting and after a failure", () => {
	useOnlineStore.setState({ connectionStatus: "connecting" });
	const { container, rerender } = render(
		<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />,
	);
	expect(screen.getByText("Connecting to server...")).toBeInTheDocument();
	expect(container.textContent).not.toMatch(/\bconnect\b/);
	expect(container.querySelector("svg.animate-spin")).not.toBeNull();
	act(() =>
		useOnlineStore.setState({
			connectionStatus: "disconnected",
			error: "Auth unavailable",
			connect: vi.fn().mockResolvedValue(undefined),
		}),
	);
	rerender(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	expect(screen.getByText("Auth unavailable")).toBeInTheDocument();
	expect(container.textContent).not.toMatch(/\berr\b/);
});

it("tells a guest the room closed when the host leaves, and offers a way back", () => {
	const leaveRoom = vi.fn();
	useOnlineStore.setState({
		isHost: false,
		room: createTestRoom({ status: "finished" }),
		leaveRoom,
	});
	render(<OnlineLobby onBack={vi.fn()} onGameStart={vi.fn()} />);
	expect(screen.getByRole("alert")).toHaveTextContent("This room has closed");
	expect(screen.queryByRole("button", { name: "Start Game" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Back to Online Lobby" }));
	expect(leaveRoom).toHaveBeenCalledOnce();
	expect(router.navigate).toHaveBeenCalledWith({ to: "/online" });
});
