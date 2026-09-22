import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { expect, it, vi } from "vitest";
import { useCursorBroadcast } from "./useCursorBroadcast";
const instances = vi.hoisted(
	() =>
		[] as Array<{
			room: string;
			uid: string;
			start: ReturnType<typeof vi.fn>;
			stop: ReturnType<typeof vi.fn>;
			updatePosition: ReturnType<typeof vi.fn>;
			clearPosition: ReturnType<typeof vi.fn>;
		}>,
);
vi.mock("../services/sync/CursorService", () => ({
	CursorService: class {
		start = vi.fn().mockResolvedValue(undefined);
		stop = vi.fn().mockResolvedValue(undefined);
		updatePosition = vi.fn();
		clearPosition = vi.fn();
		room: string;
		uid: string;
		constructor(room: string, uid: string) {
			this.room = room;
			this.uid = uid;
			instances.push(this);
		}
	},
}));
it("preserves broadcasting coordinates, bounds, clearing and lifecycle without receive state", () => {
	const props = {
		roomCode: "ABCD",
		localOdahId: "host",
		enabled: true,
		cardSize: 100,
	};
	const { result, rerender, unmount } = renderHook(
		(p) => useCursorBroadcast(p),
		{ initialProps: props },
	);
	const service = instances.at(-1)!;
	expect(service.start).toHaveBeenCalledOnce();
	const rect = { left: 10, top: 20 } as DOMRect;
	act(() =>
		result.current.handleMouseMove(
			{ clientX: 226, clientY: 128 } as MouseEvent<HTMLDivElement>,
			rect,
		),
	);
	expect(service.updatePosition).toHaveBeenCalledWith(2, 1);
	act(() =>
		result.current.handleMouseMove(
			{ clientX: 1000, clientY: 128 } as MouseEvent<HTMLDivElement>,
			rect,
		),
	);
	expect(service.clearPosition).toHaveBeenCalledOnce();
	act(() => result.current.handleMouseLeave());
	expect(service.clearPosition).toHaveBeenCalledTimes(2);
	rerender({ ...props, enabled: false });
	expect(service.stop).toHaveBeenCalledOnce();
	act(() => {
		result.current.handleMouseMove(
			{ clientX: 100, clientY: 100 } as MouseEvent<HTMLDivElement>,
			rect,
		);
		result.current.handleMouseLeave();
	});
	expect(service.updatePosition).toHaveBeenCalledOnce();
	expect(service.clearPosition).toHaveBeenCalledTimes(2);
	unmount();
});
