import { useLayoutEffect } from "react";
import { useAppModel } from "./hooks/useAppModel";
import { useAppModelStore } from "./stores/appModelStore";
import { AppShell } from "./screens/AppShell";
export default function App() {
	const model = useAppModel();
	useLayoutEffect(() => {
		useAppModelStore.setState({ model });
	}, [model]);
	useLayoutEffect(
		() => () => {
			useAppModelStore.setState({ model: null });
		},
		[],
	);
	return <AppShell model={model} />;
}
