import { GameplayScreen } from "../screens/GameplayScreen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/online/game")({
	component: GameplayScreen,
});
