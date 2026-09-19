import { ResultsScreen } from "../screens/ResultsScreen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/game-over")({
	component: ResultsScreen,
});
