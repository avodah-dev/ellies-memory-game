import { SetupScreen } from "../screens/SetupScreen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/local/start")({
	component: SetupScreen,
});
