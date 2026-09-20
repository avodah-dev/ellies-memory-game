import { summarize, type Metrics } from "./connectionTest";
export type TouchPhase = "down" | "up" | "cancel" | "click";
interface Gesture {
	down: number;
	up: number | null;
	cancelled: boolean;
	side: string;
	type: string;
}
export class TouchRecorder {
	private gestures = new Map<number, Gesture>();
	private downToUp: number[] = [];
	private downToClick: number[] = [];
	private upToClick: number[] = [];
	private types = new Set<string>();
	private downs = 0;
	private ups = 0;
	private cancels = 0;
	private clicks = 0;
	private left = 0;
	private right = 0;
	private lastClick: number | null = null;
	private clickGap: number | null = null;
	record(
		phase: TouchPhase,
		side: string,
		id: number | undefined,
		type: string,
		detail = 1,
	) {
		const at = performance.now();
		if (this.downs + this.clicks >= 200) return; // Bounded even for accidental holds/spam.
		if (type) this.types.add(type);
		if (phase === "down") {
			this.downs++;
			if (id !== undefined)
				this.gestures.set(id, {
					down: at,
					up: null,
					cancelled: false,
					side,
					type,
				});
		}
		if (phase === "up") {
			this.ups++;
			const g = id === undefined ? undefined : this.gestures.get(id);
			if (g) {
				g.up = at;
				this.downToUp.push(at - g.down);
			}
		}
		if (phase === "cancel") {
			this.cancels++;
			const g = id === undefined ? undefined : this.gestures.get(id);
			if (g) g.cancelled = true;
		}
		if (phase === "click") {
			this.clicks++;
			if (side === "left") this.left++;
			if (side === "right") this.right++;
			if (this.lastClick !== null) this.clickGap = at - this.lastClick;
			this.lastClick = at;
			const candidates = [...this.gestures.values()].filter(
				(g) => g.side === side && !g.cancelled,
			);
			const g =
				id === undefined
					? candidates.length === 1
						? candidates[0]
						: undefined
					: this.gestures.get(id);
			if (detail > 0 && g && !g.cancelled && g.side === side) {
				this.types.add(g.type);
				this.downToClick.push(at - g.down);
				if (g.up !== null) this.upToClick.push(at - g.up);
			}
			for (const [key, g] of this.gestures)
				if (g.side === side) this.gestures.delete(key);
		}
	}
	result(): Metrics {
		return {
			downs: this.downs,
			ups: this.ups,
			cancels: this.cancels,
			clicks: this.clicks,
			left_clicks: this.left,
			right_clicks: this.right,
			both_clicked: this.left > 0 && this.right > 0,
			pointer_types: [...this.types].join(","),
			matched_clicks: this.downToClick.length,
			median_down_to_up_ms: summarize(this.downToUp).median_ms,
			median_down_to_click_ms: summarize(this.downToClick).median_ms,
			p95_down_to_click_ms: summarize(this.downToClick).p95_ms,
			median_up_to_click_ms: summarize(this.upToClick).median_ms,
			last_click_gap_ms: this.clickGap,
		};
	}
}
