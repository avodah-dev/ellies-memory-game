import { create } from "zustand";
import type { AppModel } from "../hooks/useAppModel";
// Route views consume the current session model; the root owns its lifecycle.
export const useAppModelStore = create<{ model: AppModel | null }>(() => ({
	model: null,
}));
