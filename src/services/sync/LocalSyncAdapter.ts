import { instrumentAdapter } from "../telemetry/syncObserver";
/**
 * LocalSyncAdapter - Sync adapter for local (same-device) gameplay
 *
 * This is essentially a no-op adapter since Zustand's persist middleware
 * handles local storage automatically. The adapter exists to satisfy the
 * interface and allow the game logic to work identically in both modes.
 */

import type { GameState } from "../../types";
import { BaseSyncAdapter } from "./ISyncAdapter";

export class LocalSyncAdapter extends BaseSyncAdapter {
	private connected = false;
	private state: GameState | null = null;
	private subscribers = new Set<(state: GameState) => void>();

	async connect(): Promise<void> {
		this.connected = true;
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.subscribers.clear();
	}

	isConnected(): boolean {
		return this.connected;
	}

	async getState(): Promise<GameState | null> {
		return this.state;
	}

	async setState(state: GameState): Promise<void> {
		this.state = state;
		// Notify all subscribers
		this.subscribers.forEach((callback) => callback(state));
	}

	subscribeToState(callback: (state: GameState) => void): () => void {
		this.subscribers.add(callback);
		// Immediately call with current state if available
		if (this.state) {
			callback(this.state);
		}
		// Return unsubscribe function
		return () => {
			this.subscribers.delete(callback);
		};
	}
}

// Singleton instance for local mode
let localAdapterInstance: LocalSyncAdapter | null = null;

export function getLocalSyncAdapter(): LocalSyncAdapter {
	if (!localAdapterInstance) {
		localAdapterInstance = instrumentAdapter(new LocalSyncAdapter());
	}
	return localAdapterInstance;
}
