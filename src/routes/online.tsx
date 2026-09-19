import {
	createFileRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { OnlineLobbyScreen } from "../screens/OnlineLobbyScreen";
function OnlineLayout() {
	const path = useRouterState({ select: (s) => s.location.pathname });
	return path === "/online" ? <OnlineLobbyScreen /> : <Outlet />;
}
export const Route = createFileRoute("/online")({ component: OnlineLayout });
