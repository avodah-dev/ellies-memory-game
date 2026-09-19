import { OnlineLobbyScreen } from "../screens/OnlineLobbyScreen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/online/waiting")({
	component: OnlineLobbyScreen,
});
