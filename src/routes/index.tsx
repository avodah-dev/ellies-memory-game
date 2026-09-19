import { HomeScreen } from "../screens/HomeScreen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: HomeScreen,
});
