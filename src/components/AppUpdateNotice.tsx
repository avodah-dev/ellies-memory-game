import { useStore } from "zustand";
import { appUpdateStore } from "../stores/appUpdateStore";
import { buildUpdates } from "../services/updates/buildUpdate";
export function AppUpdateNotice({ onReload }: { onReload: () => void }) {
	const offered = useStore(appUpdateStore, (s) => s.offered);
	const minimized = useStore(appUpdateStore, (s) => s.minimized);
	if (!offered) return null;
	return (
		<aside
			aria-label="App update"
			className="fixed bottom-3 left-3 z-[60] max-w-[calc(100vw-6rem)] rounded-xl bg-white shadow-lg border border-indigo-200 px-3 py-2 text-gray-800"
		>
			{minimized ? (
				<button
					type="button"
					onClick={() => buildUpdates.expand()}
					className="text-sm font-semibold text-indigo-700"
				>
					Update available
				</button>
			) : (
				<div className="flex flex-wrap items-center gap-3">
					<span role="status" className="text-sm">
						Update available
					</span>
					<button
						type="button"
						onClick={onReload}
						className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-semibold text-white"
					>
						Reload
					</button>
					<button
						type="button"
						onClick={() => buildUpdates.defer()}
						className="text-sm text-gray-600"
					>
						Later
					</button>
				</div>
			)}
		</aside>
	);
}
