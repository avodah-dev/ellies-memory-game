import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePaintProbe } from "./usePaintProbe";
import { createCardSet } from "../../test/testUtils";
import { track } from "./core";
vi.mock("./core", () => ({
	track: vi.fn(),
	counters: { cardRenders: 1, boardRenders: 1, modelPublishes: 1 },
	currentInputId: () => null,
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
it("distinguishes an overwritten pre-frame state from an after-frame task", () => {
	let frame: FrameRequestCallback = () => {};
	let message: () => void = () => {};
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			frame = callback;
			return 1;
		}),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal(
		"MessageChannel",
		class {
			port1 = { onmessage: () => {}, close: vi.fn() };
			port2 = {
				postMessage: () => {
					message = () => this.port1.onmessage();
				},
				close: vi.fn(),
			};
		},
	);
	const first = createCardSet(2),
		second = createCardSet(3);
	const hook = renderHook(({ cards }) => usePaintProbe(cards), {
		initialProps: { cards: first },
	});
	hook.rerender({ cards: second });
	expect(track).toHaveBeenCalledWith(
		"mm.render.painted",
		expect.objectContaining({ phase: "cancelled-before-task" }),
	);
	act(() => {
		frame(performance.now());
		message();
	});
	expect(track).toHaveBeenLastCalledWith(
		"mm.render.painted",
		expect.objectContaining({ phase: "after-frame-task" }),
	);
	const count = vi.mocked(track).mock.calls.length;
	hook.unmount();
	expect(vi.mocked(track).mock.calls).toHaveLength(count);
});
