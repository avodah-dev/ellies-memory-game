import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CardLightbox } from "./CardLightbox";
vi.mock("../hooks/useTextToSpeech", () => ({
	useTextToSpeech: () => ({ speak: vi.fn(), isAvailable: () => false }),
}));
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
const cards = Array.from({ length: 4 }, (_, i) => ({
	id: `card-${i}`,
	imageId: `animal-${i}`,
	imageUrl: "🐱",
	isFlipped: true,
	isMatched: true,
	matchedByPlayerId: 1,
}));
it.each([
	{ name: "short fast left flick", distance: -400, duration: 200, index: 2 },
	{ name: "short fast right flick", distance: 400, duration: 200, index: 0 },
	{ name: "slow long left swipe", distance: -700, duration: 3000, index: 2 },
	{ name: "slow long right swipe", distance: 700, duration: 3000, index: 0 },
	{ name: "slow short left drag", distance: -400, duration: 3000, index: null },
	{ name: "slow short right drag", distance: 400, duration: 3000, index: null },
])(
	"$name honors the distance/velocity gesture contract",
	({ distance, duration, index }) => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		vi.stubGlobal("innerWidth", 1000);
		const navigate = vi.fn();
		render(
			<CardLightbox
				isOpen
				onClose={vi.fn()}
				card={cards[1]}
				cards={cards}
				currentIndex={1}
				onNavigate={navigate}
			/>,
		);
		const display = screen.getByRole("region", { name: "Card display" });
		fireEvent.touchStart(display, {
			touches: [{ clientX: 500, clientY: 200 }],
		});
		fireEvent.touchMove(display, {
			touches: [{ clientX: 500 + distance, clientY: 200 }],
		});
		vi.setSystemTime(duration);
		fireEvent.touchEnd(display, { touches: [] });
		if (index === null) expect(navigate).not.toHaveBeenCalled();
		else {
			expect(navigate).toHaveBeenCalledExactlyOnceWith(index);
		}
	},
);
