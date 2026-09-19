/**
 * Render Helpers for Testing
 *
 * Custom render functions that wrap components with necessary providers.
 * - renderWithProviders: For testing components with store access
 * - renderWithRouter: For testing components that use TanStack Router
 * - renderHookWithProviders: For testing hooks
 */

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	type RenderHookOptions,
	type RenderOptions,
	render,
	renderHook,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// ============================================
// Types
// ============================================

interface WrapperProps {
	children: ReactNode;
}

type RenderWithProvidersOptions = Omit<RenderOptions, "wrapper">;

interface RenderWithRouterOptions extends RenderWithProvidersOptions {
	/**
	 * Initial route path for the router
	 * @default "/"
	 */
	initialPath?: string;
	/**
	 * Route paths to register (in addition to the default "/" and current path)
	 */
	routes?: string[];
}

// ============================================
// Provider Wrappers
// ============================================

/**
 * Base wrapper that provides store access.
 * Zustand stores don't need providers, but this wrapper can be extended
 * for any future provider needs.
 */
function BaseWrapper({ children }: WrapperProps): ReactElement {
	return <>{children}</>;
}

/**
 * Creates a router wrapper for testing route-dependent components.
 * Uses TanStack Router's memory history for testing.
 */
function createRouterWrapper(
	initialPath: string = "/",
	additionalRoutes: string[] = [],
) {
	let content: ReactNode;
	// Create a root route
	const rootRoute = createRootRoute({
		component: () => <BaseWrapper>{content}</BaseWrapper>,
	});

	// Collect all unique paths
	const allPaths = new Set(["/", initialPath, ...additionalRoutes]);

	// Create child routes for each path
	const childRoutes = Array.from(allPaths).map((path) => {
		// Handle root path specially
		if (path === "/") {
			return createRoute({
				getParentRoute: () => rootRoute,
				path: "/",
				component: () => null,
			});
		}

		return createRoute({
			getParentRoute: () => rootRoute,
			path: path,
			component: () => null,
		});
	});

	// Add child routes to root
	const routeTree = rootRoute.addChildren(childRoutes);

	// Create router with memory history
	const memoryHistory = createMemoryHistory({
		initialEntries: [initialPath],
	});

	const router = createRouter({
		routeTree,
		history: memoryHistory,
	});

	// Return wrapper component
	return function RouterWrapper({ children }: WrapperProps): ReactElement {
		content = children;
		return <RouterProvider router={router} />;
	};
}

// ============================================
// Custom Render Functions
// ============================================

/**
 * Render a component with access to Zustand stores.
 * Use this for components that don't need routing.
 *
 * @example
 * ```tsx
 * const { getByText } = renderWithProviders(<MyComponent />);
 * ```
 */
export function renderWithProviders(
	ui: ReactElement,
	options?: RenderWithProvidersOptions,
) {
	return render(ui, {
		wrapper: BaseWrapper,
		...options,
	});
}

/**
 * Render a component with TanStack Router context.
 * Use this for components that use useNavigate, useLocation, Link, etc.
 *
 * @example
 * ```tsx
 * const { getByRole } = renderWithRouter(<NavigatingComponent />, {
 *   initialPath: "/local/game",
 *   routes: ["/local/theme", "/local/game"],
 * });
 * ```
 */
export function renderWithRouter(
	ui: ReactElement,
	options?: RenderWithRouterOptions,
) {
	const { initialPath = "/", routes = [], ...renderOptions } = options ?? {};

	const Wrapper = createRouterWrapper(initialPath, routes);

	return render(ui, {
		wrapper: Wrapper,
		...renderOptions,
	});
}

/**
 * Render a hook with access to Zustand stores.
 *
 * @example
 * ```tsx
 * const { result } = renderHookWithProviders(() => useMyHook());
 * expect(result.current.value).toBe("expected");
 * ```
 */
export function renderHookWithProviders<TResult, TProps>(
	hook: (props: TProps) => TResult,
	options?: RenderHookOptions<TProps>,
) {
	return renderHook(hook, {
		wrapper: BaseWrapper,
		...options,
	});
}

/**
 * Render a hook that requires router context.
 *
 * @example
 * ```tsx
 * const { result } = renderHookWithRouter(
 *   () => useRouterDependentHook(),
 *   { initialPath: "/local/game" }
 * );
 * ```
 */
export function renderHookWithRouter<TResult, TProps>(
	hook: (props: TProps) => TResult,
	options?: RenderHookOptions<TProps> & {
		initialPath?: string;
		routes?: string[];
	},
) {
	const { initialPath = "/", routes = [], ...hookOptions } = options ?? {};

	const Wrapper = createRouterWrapper(initialPath, routes);

	return renderHook(hook, {
		wrapper: Wrapper,
		...hookOptions,
	});
}

// ============================================
// Test Helpers
// ============================================

/**
 * Wait for a store update by subscribing to changes.
 * Useful for testing async store actions.
 *
 * @example
 * ```tsx
 * await waitForStoreUpdate(useSettingsStore, (state) => state.settings.cardPack === "food");
 * ```
 */
export async function waitForStoreUpdate<TState>(
	store: {
		getState: () => TState;
		subscribe: (listener: (state: TState) => void) => () => void;
	},
	predicate: (state: TState) => boolean,
	timeout: number = 1000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		// Check if already satisfied
		if (predicate(store.getState())) {
			resolve();
			return;
		}

		const timeoutId = setTimeout(() => {
			unsubscribe();
			reject(new Error(`waitForStoreUpdate timed out after ${timeout}ms`));
		}, timeout);

		const unsubscribe = store.subscribe((state) => {
			if (predicate(state)) {
				clearTimeout(timeoutId);
				unsubscribe();
				resolve();
			}
		});
	});
}

/**
 * Create a spy function that tracks calls.
 * Simpler alternative to vi.fn() for basic cases.
 */
export function createSpy<T extends (...args: unknown[]) => unknown>() {
	const calls: Parameters<T>[] = [];
	const spy = ((...args: Parameters<T>) => {
		calls.push(args);
	}) as T & {
		calls: Parameters<T>[];
		callCount: number;
		lastCall: Parameters<T> | undefined;
	};

	Object.defineProperty(spy, "calls", { get: () => calls });
	Object.defineProperty(spy, "callCount", { get: () => calls.length });
	Object.defineProperty(spy, "lastCall", {
		get: () => calls[calls.length - 1],
	});

	return spy;
}
