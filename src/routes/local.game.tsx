import { GameplayScreen } from "../screens/GameplayScreen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/local/game")({
	component: GameplayScreen,
});
