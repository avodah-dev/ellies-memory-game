import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
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
it("honors a full swipe delivered before React paints intermediate gesture state", () => {
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
	act(() => {
		fireEvent.touchStart(display, {
			touches: [{ identifier: 1, clientX: 100, clientY: 200 }],
		});
		fireEvent.touchMove(display, {
			touches: [{ identifier: 1, clientX: 800, clientY: 200 }],
		});
		vi.setSystemTime(1000);
		fireEvent.touchEnd(display, {
			touches: [],
			changedTouches: [{ identifier: 1, clientX: 800, clientY: 200 }],
		});
	});
	expect(navigate).toHaveBeenCalledExactlyOnceWith(0);
});
it("late animation frames cannot reset the next gesture after transition cleanup", () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	vi.stubGlobal("innerWidth", 1000);
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
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
	fireEvent.touchStart(display, { touches: [{ clientX: 800, clientY: 200 }] });
	fireEvent.touchMove(display, { touches: [{ clientX: 100, clientY: 200 }] });
	vi.setSystemTime(1000);
	fireEvent.touchEnd(display, { touches: [] });
	expect(navigate).toHaveBeenCalledExactlyOnceWith(2);
	act(() => {
		vi.advanceTimersByTime(301);
	});
	fireEvent.touchStart(display, { touches: [{ clientX: 100, clientY: 200 }] });
	fireEvent.touchMove(display, { touches: [{ clientX: 800, clientY: 200 }] });
	act(() => {
		while (frames.length) frames.shift()!(performance.now());
	});
	expect((display.lastElementChild as HTMLElement).style.transform).toContain(
		"translateX(700px)",
	);
	vi.setSystemTime(2301);
	fireEvent.touchEnd(display, { touches: [] });
	expect(navigate.mock.calls).toEqual([[2], [0]]);
});
it("cancellation discards a gesture and a later end cannot navigate", () => {
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
	fireEvent.touchStart(display, { touches: [{ clientX: 100, clientY: 200 }] });
	fireEvent.touchMove(display, { touches: [{ clientX: 1000, clientY: 200 }] });
	fireEvent.touchCancel(display);
	fireEvent.touchEnd(display);
	expect(navigate).not.toHaveBeenCalled();
	expect((display.lastElementChild as HTMLElement).style.transform).toContain(
		"translateX(0px)",
	);
});
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
