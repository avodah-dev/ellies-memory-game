import { OnlineLobby } from "../components/online";
import { useAppModelStore } from "../stores/appModelStore";
export function OnlineLobbyScreen() {
	const model = useAppModelStore((s) => s.model);
	if (!model) return null;
	const { currentPath, setGameMode, navigate, setFullGameState } = model;
	return (
		<>
			{/* Online Lobby */}
			{(currentPath === "/online" ||
				currentPath === "/online/create" ||
				currentPath === "/online/join" ||
				currentPath === "/online/waiting") && (
				<div className="flex flex-col items-center min-h-[60vh] overflow-y-auto max-h-[calc(100vh-4rem)] py-4">
					<OnlineLobby
						onBack={() => {
							setGameMode(null);
							sessionStorage.removeItem("appNavigation");
							navigate({ to: "/" });
						}}
						onGameStart={(onlineGameState) => {
							// Set the game state from online lobby
							setFullGameState(onlineGameState);
							sessionStorage.setItem("appNavigation", "true");
							navigate({ to: "/online/game" });
						}}
					/>
				</div>
			)}
		</>
	);
}
