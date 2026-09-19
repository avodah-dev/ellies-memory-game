/**
 * Screenfull Mock for Testing
 *
 * Provides mock implementation of the screenfull library
 * for testing fullscreen functionality.
 */

import { vi } from "vitest";

// ============================================
// Mock Screenfull State
// ============================================

export interface MockScreenfullState {
	isFullscreen: boolean;
	isEnabled: boolean;
	element: Element | null;
	changeCallbacks: (() => void)[];
	errorCallbacks: ((error: Error) => void)[];
}

let state: MockScreenfullState = {
	isFullscreen: false,
	isEnabled: true,
	element: null,
	changeCallbacks: [],
	errorCallbacks: [],
};

// ============================================
// Mock Screenfull Implementation
// ============================================

export const mockScreenfull = {
	get isFullscreen() {
		return state.isFullscreen;
	},

	get isEnabled() {
		return state.isEnabled;
	},

	get element() {
		return state.element;
	},

	request: vi.fn(async (element?: Element) => {
		if (!state.isEnabled) {
			const error = new Error("Fullscreen not enabled");
			state.errorCallbacks.forEach((cb) => cb(error));
			throw error;
		}
		state.isFullscreen = true;
		state.element = element ?? document.documentElement;
		state.changeCallbacks.forEach((cb) => cb());
	}),

	exit: vi.fn(async () => {
		state.isFullscreen = false;
		state.element = null;
		state.changeCallbacks.forEach((cb) => cb());
	}),

	toggle: vi.fn(async (element?: Element) => {
		if (state.isFullscreen) {
			await mockScreenfull.exit();
		} else {
			await mockScreenfull.request(element);
		}
	}),

	on: vi.fn((event: string, callback: (error?: Error) => void) => {
		if (event === "change") {
			state.changeCallbacks.push(callback);
		} else if (event === "error") {
			state.errorCallbacks.push(callback as (error: Error) => void);
		}
	}),

	off: vi.fn((event: string, callback: (error?: Error) => void) => {
		if (event === "change") {
			const index = state.changeCallbacks.indexOf(callback);
			if (index > -1) {
				state.changeCallbacks.splice(index, 1);
			}
		} else if (event === "error") {
			const index = state.errorCallbacks.indexOf(
				callback as (error: Error) => void,
			);
			if (index > -1) {
				state.errorCallbacks.splice(index, 1);
			}
		}
	}),

	onchange: null as (() => void) | null,
	onerror: null as ((error: Error) => void) | null,
};

// ============================================
// Test Helpers
// ============================================

/**
 * Setup screenfull mock.
 * Call in beforeEach() to reset state.
 */
export function setupScreenfullMock(options: { isEnabled?: boolean } = {}) {
	state = {
		isFullscreen: false,
		isEnabled: options.isEnabled ?? true,
		element: null,
		changeCallbacks: [],
		errorCallbacks: [],
	};

	mockScreenfull.request.mockClear();
	mockScreenfull.exit.mockClear();
	mockScreenfull.toggle.mockClear();
	mockScreenfull.on.mockClear();
	mockScreenfull.off.mockClear();

	return mockScreenfull;
}

/**
 * Simulate entering fullscreen mode.
 * Triggers change callbacks.
 */
export function simulateFullscreen(element?: Element) {
	state.isFullscreen = true;
	state.element = element ?? document.documentElement;
	state.changeCallbacks.forEach((cb) => cb());
	if (mockScreenfull.onchange) {
		mockScreenfull.onchange();
	}
}

/**
 * Simulate exiting fullscreen mode.
 * Triggers change callbacks.
 */
export function simulateExitFullscreen() {
	state.isFullscreen = false;
	state.element = null;
	state.changeCallbacks.forEach((cb) => cb());
	if (mockScreenfull.onchange) {
		mockScreenfull.onchange();
	}
}

/**
 * Simulate fullscreen error.
 * Triggers error callbacks.
 */
export function simulateFullscreenError(message: string = "Fullscreen error") {
	const error = new Error(message);
	state.errorCallbacks.forEach((cb) => cb(error));
	if (mockScreenfull.onerror) {
		mockScreenfull.onerror(error);
	}
}

/**
 * Disable fullscreen support.
 * Useful for testing fallback behavior.
 */
export function disableFullscreen() {
	state.isEnabled = false;
}

/**
 * Enable fullscreen support.
 */
export function enableFullscreen() {
	state.isEnabled = true;
}

/**
 * Reset screenfull mock.
 * Call in afterEach() to clean up.
 */
export function resetScreenfullMock() {
	state = {
		isFullscreen: false,
		isEnabled: true,
		element: null,
		changeCallbacks: [],
		errorCallbacks: [],
	};
}

// ============================================
// Module Mock Factory
// ============================================

/**
 * Create screenfull mock for vi.mock().
 *
 * @example
 * ```ts
 * vi.mock("screenfull", () => createScreenfullMock());
 * ```
 */
export function createScreenfullMock() {
	return {
		default: mockScreenfull,
	};
}
