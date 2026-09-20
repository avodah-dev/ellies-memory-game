import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
	DEVICE_ID_KEY,
	getDeviceIdentity,
	getPageSessionId,
	resetIdentityForTests,
} from "./identity";
beforeEach(() => {
	localStorage.clear();
	resetIdentityForTests();
});
afterEach(() => vi.restoreAllMocks());
describe("device identity", () => {
	it("persists a random ID independently of preferences and keeps page sessions distinct", () => {
		const first = getDeviceIdentity();
		const session = getPageSessionId();
		expect(first.persisted).toBe(true);
		expect(first.isNew).toBe(true);
		expect(first.label).toBe(first.id.slice(-4).toUpperCase());
		localStorage.removeItem("settings");
		resetIdentityForTests();
		expect(getDeviceIdentity()).toEqual({ ...first, isNew: false });
		expect(getPageSessionId()).not.toBe(session);
	});
	it.each(["getItem", "setItem"] as const)(
		"explicitly reports session-only identity if %s throws",
		(method) => {
			vi.spyOn(Storage.prototype, method).mockImplementation(() => {
				throw new Error("denied");
			});
			const identity = getDeviceIdentity();
			expect(identity.persisted).toBe(false);
			expect(identity.id).toMatch(/^[a-f0-9-]{36}$/);
			expect(getDeviceIdentity()).toBe(identity);
		},
	);
	it("replaces malformed IDs rather than treating user text as identity", () => {
		localStorage.setItem(DEVICE_ID_KEY, "a player name");
		expect(getDeviceIdentity().id).not.toBe("a player name");
	});
});
