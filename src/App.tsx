import { counters } from "./services/telemetry/core";
import { useLayoutEffect } from "react";
import { useAppModel } from "./hooks/useAppModel";
import { useAppModelStore } from "./stores/appModelStore";
import { AppShell } from "./screens/AppShell";
export default function App() {
	counters.appRenders++;
	const model = useAppModel();
	useLayoutEffect(() => {
		counters.modelPublishes++;
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
