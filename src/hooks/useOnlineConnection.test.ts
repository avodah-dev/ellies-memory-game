import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOnlineConnection } from "./useOnlineConnection";
import { useOnlineStore } from "../stores/onlineStore";

const clock = vi.hoisted(() => ({ connectionChanged: vi.fn(), stop: vi.fn() }));
vi.mock("../services/telemetry/rtdbClock", () => ({
	observeRtdbClock: () => clock,
}));
const connection = vi.hoisted(() => ({
	deliver: (_snapshot: { val: () => boolean }) => {},
	stop: vi.fn(),
}));
vi.mock("../lib/firebase", () => ({ rtdb: {} }));
vi.mock("../services/sync/FirestoreSyncAdapter", () => ({}));
vi.mock("../services/sync/PresenceService", () => ({}));
vi.mock("firebase/database", () => ({
	ref: vi.fn(),
	onValue: vi.fn((_ref, callback) => {
		connection.deliver = callback;
		callback({ val: () => true });
		return connection.stop;
	}),
}));
beforeEach(() => {
	vi.clearAllMocks();
	useOnlineStore.setState({ opponentConnected: true });
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
it("resumes after a brief browser outage even when Firebase's socket stays connected", () => {
	const hook = renderHook(() => useOnlineConnection("TEST"));
	expect(hook.result.current).toBe(true);
	act(() => window.dispatchEvent(new Event("offline")));
	expect(hook.result.current).toBe(false);
	act(() => window.dispatchEvent(new Event("online")));
	expect(hook.result.current).toBe(true);
});
it("still waits for Firebase and the opponent after browser connectivity returns", () => {
	const hook = renderHook(() => useOnlineConnection("TEST"));
	act(() => {
		window.dispatchEvent(new Event("offline"));
		connection.deliver({ val: () => false });
	});
	act(() => window.dispatchEvent(new Event("online")));
	expect(hook.result.current).toBe(false);
	act(() => {
		useOnlineStore.setState({ opponentConnected: false });
		connection.deliver({ val: () => true });
	});
	expect(hook.result.current).toBe(false);
	act(() => useOnlineStore.setState({ opponentConnected: true }));
	expect(hook.result.current).toBe(true);
});

it("observes connection and cleanup without making readiness depend on calibration", () => {
	const hook = renderHook(() => useOnlineConnection("TEST"));
	expect(hook.result.current).toBe(true);
	expect(clock.connectionChanged).toHaveBeenLastCalledWith(true);
	act(() => connection.deliver({ val: () => false }));
	expect(clock.connectionChanged).toHaveBeenLastCalledWith(false);
	hook.unmount();
	expect(clock.stop).toHaveBeenCalledTimes(1);
	expect(connection.stop).toHaveBeenCalledTimes(1);
});
