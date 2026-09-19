import { createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import App from "../App";

const isDev = import.meta.env.MODE === "development";

// Named component to prevent remounting on route changes
function RootComponent() {
	return (
		<>
			<App />
			{isDev && <TanStackRouterDevtools />}
		</>
	);
}

export const Route = createRootRoute({
	component: RootComponent,
});
