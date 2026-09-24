import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GameBoard } from "../GameBoard";
import { createCardSet } from "../../test/testUtils";
import { counters } from "../../services/telemetry/core";
import type { CursorPosition } from "../../types";

const subscriptions = vi.hoisted(
	() =>
		[] as Array<{
			room: string;
			uid: string;
			deliver: (p: CursorPosition | null) => void;
			stop: ReturnType<typeof vi.fn>;
		}>,
);
vi.mock("../../services/sync/CursorService", () => ({
	CursorService: {
		subscribeToCursor(
			room: string,
			uid: string,
			deliver: (p: CursorPosition | null) => void,
		) {
			const stop = vi.fn();
			subscriptions.push({ room, uid, deliver, stop });
			return stop;
		},
	},
}));
vi.mock("../../hooks/useTextToSpeech", () => ({
	useTextToSpeech: () => ({ speak: vi.fn(), isAvailable: () => false }),
}));
beforeEach(() => {
	subscriptions.length = 0;
});
afterEach(cleanup);
const peer = {
	roomCode: "ABCD",
	opponentOdahId: "guest",
	playerName: "Guest",
	playerColor: "#123456",
};
const cards = createCardSet(4);

it("moves only the leaf cursor, without rerendering its ancestor, board or cards", () => {
	let ancestorRenders = 0;
	function Parent() {
		ancestorRenders++;
		return (
			<GameBoard
				cards={cards}
				onCardClick={() => {}}
				cardSize={100}
				remoteCursorPeer={peer}
			/>
		);
	}
	render(<Parent />);
	const baseline = {
		ancestor: ancestorRenders,
		board: counters.boardRenders,
		cards: counters.cardRenders,
		rx: counters.cursorRx,
	};
	for (let i = 1; i <= 100; i++)
		act(() => subscriptions[0].deliver({ x: i / 20, y: 2, timestamp: i }));
	const overlay = screen.getByRole("img", {
		name: "Guest's cursor",
	}).parentElement!;
	expect(overlay).toHaveStyle({ left: "540px", top: "216px" });
	expect(ancestorRenders).toBe(baseline.ancestor);
	expect(counters.boardRenders).toBe(baseline.board);
	expect(counters.cardRenders).toBe(baseline.cards);
	expect(counters.cursorRx - baseline.rx).toBe(100);
	expect(subscriptions).toHaveLength(1);
	act(() => subscriptions[0].deliver(null));
	expect(
		screen.queryByRole("img", { name: "Guest's cursor" }),
	).not.toBeInTheDocument();
	expect(counters.boardRenders).toBe(baseline.board);
});
it("updates geometry and display metadata without resubscribing", () => {
	const { rerender } = render(
		<GameBoard
			cards={cards}
			onCardClick={() => {}}
			cardSize={100}
			remoteCursorPeer={peer}
		/>,
	);
	act(() => subscriptions[0].deliver({ x: 2, y: 1, timestamp: 1 }));
	rerender(
		<GameBoard
			cards={cards}
			onCardClick={() => {}}
			cardSize={80}
			remoteCursorPeer={{
				...peer,
				playerName: "Renamed",
				playerColor: "#ffffff",
			}}
		/>,
	);
	expect(
		screen.getByRole("img", { name: "Renamed's cursor" }).parentElement,
	).toHaveStyle({ left: "176px", top: "88px" });
	expect(screen.getByText("Renamed")).toHaveStyle({
		backgroundColor: "#ffffff",
	});
	expect(subscriptions).toHaveLength(1);
	act(() => subscriptions[0].deliver({ x: 9, y: 1, timestamp: 2 }));
	expect(
		screen.queryByRole("img", { name: "Renamed's cursor" }),
	).not.toBeInTheDocument();
});
it.each(["roomCode", "opponentOdahId"] as const)(
	"clears position across %s changes and ignores stale callbacks",
	(field) => {
		const { rerender, unmount } = render(
			<GameBoard
				cards={cards}
				onCardClick={() => {}}
				remoteCursorPeer={peer}
			/>,
		);
		act(() => subscriptions[0].deliver({ x: 1, y: 1, timestamp: 1 }));
		rerender(
			<GameBoard
				cards={cards}
				onCardClick={() => {}}
				remoteCursorPeer={{ ...peer, [field]: "NEXT" }}
			/>,
		);
		expect(subscriptions[0].stop).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByRole("img", { name: "Guest's cursor" }),
		).not.toBeInTheDocument();
		const rx = counters.cursorRx;
		act(() => subscriptions[0].deliver({ x: 3, y: 1, timestamp: 2 }));
		expect(counters.cursorRx).toBe(rx);
		expect(
			screen.queryByRole("img", { name: "Guest's cursor" }),
		).not.toBeInTheDocument();
		act(() => subscriptions[1].deliver({ x: 2, y: 1, timestamp: 3 }));
		expect(
			screen.getByRole("img", { name: "Guest's cursor" }),
		).toBeInTheDocument();
		rerender(
			<GameBoard
				cards={cards}
				onCardClick={() => {}}
				remoteCursorPeer={null}
			/>,
		);
		expect(subscriptions[1].stop).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByRole("img", { name: "Guest's cursor" }),
		).not.toBeInTheDocument();
		unmount();
		act(() => subscriptions[1].deliver({ x: 4, y: 1, timestamp: 4 }));
		expect(subscriptions).toHaveLength(2);
	},
);
