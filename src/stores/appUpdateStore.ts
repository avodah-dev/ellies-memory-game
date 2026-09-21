import { createStore } from "zustand/vanilla";
export interface AppUpdateState {
	offered: string | null;
	minimized: boolean;
	error: string | null;
}
export const createAppUpdateStore = () =>
	createStore<AppUpdateState>(() => ({
		offered: null,
		minimized: false,
		error: null,
	}));
export const appUpdateStore = createAppUpdateStore();
