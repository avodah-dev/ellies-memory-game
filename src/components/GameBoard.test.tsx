import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GameBoard } from "./GameBoard";
import { createCardSet } from "../test/testUtils";
vi.mock("../hooks/useTextToSpeech", () => ({
	useTextToSpeech: () => ({ speak: vi.fn(), isAvailable: () => false }),
}));
afterEach(cleanup);

it("hands an unfinished deal pose to the flight without a transformed ancestor", () => {
	const cards = createCardSet(2);
	const { container, rerender } = render(
		<GameBoard cards={cards} onCardClick={vi.fn()} isAnimating />,
	);
	const face = container.querySelector(".card-fly-in") as HTMLElement;
	const cell = face.parentElement!;
	const image = face.querySelector("img");
	face.style.transform = "matrix(1, 0, 0, 1, 12, 18)";
	face.style.opacity = "0.9";
	vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
		left: 200,
		top: 300,
		width: 100,
		height: 100,
	} as DOMRect);
	rerender(
		<GameBoard
			cards={cards.map((c) => ({
				...c,
				isMatched: true,
				matchedByPlayerId: 1,
			}))}
			onCardClick={vi.fn()}
			isAnimating
		/>,
	);
	expect(face).toHaveClass("card-fly-to-player");
	expect(face).not.toHaveClass("card-fly-in");
	expect(cell).not.toHaveClass("card-fly-in");
	expect(face.querySelector("img")).toBe(image);
	expect(face.style.getPropertyValue("--flight-start-transform")).toBe(
		"matrix(1, 0, 0, 1, 12, 18)",
	);
	expect(face.style.getPropertyValue("--flight-start-opacity")).toBe("0.9");
	expect(face.style.getPropertyValue("--end-x")).toBe(
		`${window.innerWidth * 0.25 - 50 - 200}px`,
	);
});

it("flies only new matches, including transitions with no selected-card render", () => {
	const cards = createCardSet(3).map((card, i) => ({
		...card,
		isMatched: i < 2,
		isFlipped: i < 2,
		matchedByPlayerId: i < 2 ? 1 : undefined,
	}));
	const { container, rerender } = render(
		<GameBoard cards={cards} onCardClick={vi.fn()} />,
	);
	// A mounted/rejoined board must not replay the already recorded matches.
	expect(container.querySelectorAll(".card-fly-to-player")).toHaveLength(0);
	const next = cards.map((card, i) => ({
		...card,
		isMatched: i < 4,
		isFlipped: i < 5,
		matchedByPlayerId: i < 4 ? 1 : undefined,
	}));
	rerender(<GameBoard cards={next} onCardClick={vi.fn()} />);
	const flights = container.querySelectorAll(".card-fly-to-player");
	expect(flights).toHaveLength(2);
	expect(
		[...flights].map((f) =>
			f.querySelector("[data-card-id]")?.getAttribute("data-card-id"),
		),
	).toEqual(["card-2", "card-3"]);
	expect(container.querySelector('[data-card-id="card-4"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	flights.forEach((f) => fireEvent.animationEnd(f));
	expect(container.querySelectorAll(".card-fly-to-player")).toHaveLength(0);
	expect(container.querySelector('[data-card-id="card-4"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

it.each([false, true])(
	"keeps the painted image and face styling through flight (white=%s)",
	(white) => {
		const cards = createCardSet(2).map((card) => ({
			...card,
			isFlipped: true,
			gradient: "from-red-500 to-blue-500",
		}));
		const renderBoard = (matched: boolean) => (
			<GameBoard
				cards={cards.map((card, i) => ({
					...card,
					isMatched: matched && i < 2,
				}))}
				onCardClick={vi.fn()}
				useWhiteCardBackground={white}
			/>
		);
		const { container, rerender } = render(renderBoard(false));
		const button = container.querySelector('[data-card-id="card-0"]')!;
		const image = button.querySelector("img")!;
		const content = image.parentElement!;
		const face = content.parentElement!;
		const styling = {
			background: face.className,
			fontSize: content.style.fontSize,
		};
		rerender(renderBoard(true));
		const flight = container.querySelector(".card-fly-to-player")!;
		expect(flight.querySelector("img")).toBe(image);
		expect(image.isConnected).toBe(true);
		expect(flight.querySelector("button")).toBe(button);
		expect(button).toBeDisabled();
		expect({
			background: face.className,
			fontSize: content.style.fontSize,
		}).toEqual(styling);
		expect(flight).toHaveClass("pointer-events-none");
		fireEvent.animationEnd(image); // Descendant animation must not end the flight.
		expect(image.isConnected).toBe(true);
		fireEvent.animationEnd(flight);
		expect(image.isConnected).toBe(false);
		expect(
			container.querySelector('[data-card-id="card-2"]'),
		).toBeInTheDocument();
	},
);
