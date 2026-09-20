import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "firebase/database";
import { observeRtdbClock } from "./rtdbClock";
import { getOffsets, resetClockForTests } from "./clock";
const listener = vi.hoisted(() => ({
	value: (_snapshot: { val(): unknown }) => {},
	error: () => {},
	stop: vi.fn(),
	throwOnSubscribe: false,
}));
vi.mock("firebase/database", () => ({
	ref: (_database: unknown, path: string) => path,
	onValue: (
		path: string,
		value: typeof listener.value,
		error: typeof listener.error,
	) => {
		expect(path).toBe(".info/serverTimeOffset");
		if (listener.throwOnSubscribe) throw new Error("unavailable");
		listener.value = value;
		listener.error = error;
		return listener.stop;
	},
}));
vi.mock("./core", () => ({ track: vi.fn() }));
afterEach(() => {
	resetClockForTests();
	vi.clearAllMocks();
	listener.throwOnSubscribe = false;
});
it("requires a numeric sample and a live connection; invalidates on disconnect and stop", () => {
	const clock = observeRtdbClock({} as Database);
	listener.value({ val: () => -15 });
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	clock.connectionChanged(true);
	expect(getOffsets().offset_rtdb_ms).toBe(-15);
	clock.connectionChanged(false);
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	listener.value({ val: () => -20 });
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	clock.connectionChanged(true);
	expect(getOffsets().offset_rtdb_ms).toBe(-20);
	clock.stop();
	clock.stop();
	listener.value({ val: () => 2 });
	clock.connectionChanged(true);
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	expect(listener.stop).toHaveBeenCalledTimes(1);
});
it("accepts a genuine zero sample and invalidates on missing/invalid values or listener errors", () => {
	const clock = observeRtdbClock({} as Database);
	clock.connectionChanged(true);
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	for (const value of [null, "0", NaN, Infinity]) {
		listener.value({ val: () => 0 });
		expect(getOffsets().offset_rtdb_ms).toBe(0);
		listener.value({ val: () => value });
		expect(getOffsets().offset_rtdb_ms).toBeNull();
	}
	listener.value({ val: () => 12 });
	listener.error();
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	clock.stop();
});
it("keeps subscription failure silent and uncalibrated", () => {
	listener.throwOnSubscribe = true;
	const clock = observeRtdbClock({} as Database);
	expect(() => clock.connectionChanged(true)).not.toThrow();
	expect(getOffsets().offset_rtdb_ms).toBeNull();
	expect(() => clock.stop()).not.toThrow();
});
