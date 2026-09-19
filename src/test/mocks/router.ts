import type { ReactNode, AnchorHTMLAttributes } from "react";
/**
 * Router Mock for Testing
 *
 * Provides mock implementations of TanStack Router hooks
 * for testing components that use navigation.
 */

import { vi } from "vitest";

// ============================================
// Mock Navigation State
// ============================================

export interface MockRouterState {
	currentPath: string;
	searchParams: Record<string, string>;
	history: string[];
}

let routerState: MockRouterState = {
	currentPath: "/",
	searchParams: {},
	history: ["/"],
};

// ============================================
// Mock Hook Implementations
// ============================================

/**
 * Mock useNavigate hook.
 * Returns a function that updates the mock router state.
 */
export const mockNavigate = vi.fn(
	(options: { to: string; search?: Record<string, string> } | string) => {
		const path = typeof options === "string" ? options : options.to;
		const search = typeof options === "object" ? options.search || {} : {};

		routerState.currentPath = path;
		routerState.searchParams = search;
		routerState.history.push(path);
	},
);

export const useNavigateMock = vi.fn(() => mockNavigate);

/**
 * Mock useLocation hook.
 * Returns current path information.
 */
export const useLocationMock = vi.fn(() => ({
	pathname: routerState.currentPath,
	search: routerState.searchParams,
	hash: "",
}));

/**
 * Mock useRouterState hook.
 * Returns router state with location info.
 */
export const useRouterStateMock = vi.fn(() => ({
	location: {
		pathname: routerState.currentPath,
		search: routerState.searchParams,
		hash: "",
		href: routerState.currentPath,
	},
	isLoading: false,
	isTransitioning: false,
}));

/**
 * Mock useSearch hook.
 * Returns current search params.
 */
export const useSearchMock = vi.fn(() => routerState.searchParams);

/**
 * Mock useParams hook.
 * Returns empty params by default.
 */
export const useParamsMock = vi.fn(() => ({}));

/**
 * Mock useMatch hook.
 * Returns match info for current route.
 */
export const useMatchMock = vi.fn((path?: string) => {
	const isMatch = path ? routerState.currentPath.startsWith(path) : true;
	return isMatch
		? {
				id: routerState.currentPath,
				pathname: routerState.currentPath,
				params: {},
			}
		: undefined;
});

// ============================================
// Test Helpers
// ============================================

/**
 * Set the current mock route.
 * Use in tests to simulate navigation.
 *
 * @example
 * ```ts
 * setMockRoute("/local/game");
 * // Component now sees path as "/local/game"
 * ```
 */
export function setMockRoute(
	path: string,
	search: Record<string, string> = {},
) {
	routerState.currentPath = path;
	routerState.searchParams = search;
	routerState.history.push(path);
}

/**
 * Get the navigation history.
 * Useful for asserting navigation sequences.
 */
export function getMockNavigationHistory(): string[] {
	return [...routerState.history];
}

/**
 * Get the current mock route.
 */
export function getMockCurrentRoute(): string {
	return routerState.currentPath;
}

/**
 * Reset router state.
 * Call in afterEach() to clean up.
 */
export function resetRouterMocks() {
	routerState = {
		currentPath: "/",
		searchParams: {},
		history: ["/"],
	};
	mockNavigate.mockClear();
	useNavigateMock.mockClear();
	useLocationMock.mockClear();
	useRouterStateMock.mockClear();
	useSearchMock.mockClear();
	useParamsMock.mockClear();
	useMatchMock.mockClear();
}

// ============================================
// Module Mock Factory
// ============================================

/**
 * Create TanStack Router mock for vi.mock().
 *
 * @example
 * ```ts
 * vi.mock("@tanstack/react-router", () => createRouterMock());
 * ```
 */
export function createRouterMock() {
	return {
		useNavigate: useNavigateMock,
		useLocation: useLocationMock,
		useRouterState: useRouterStateMock,
		useSearch: useSearchMock,
		useParams: useParamsMock,
		useMatch: useMatchMock,
		Link: ({
			to,
			children,
			...props
		}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => {
			return {
				type: "a",
				props: {
					href: to,
					onClick: (e: Event) => {
						e.preventDefault();
						mockNavigate({ to });
					},
					...props,
					children,
				},
			};
		},
		Outlet: () => null,
		RouterProvider: ({ children }: { children: ReactNode }) => children,
	};
}
