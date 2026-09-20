import { afterEach, expect, it, vi } from "vitest";
import { TouchRecorder } from "./touchProbe";
afterEach(() => vi.restoreAllMocks());
it("records rapid pairs without changing their pointer/click handling", () => {
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const r = new TouchRecorder();
	r.record("down", "left", 1, "touch");
	now = 20;
	r.record("up", "left", 1, "touch");
	now = 30;
	r.record("click", "left", 1, "touch");
	now = 50;
	r.record("down", "right", 2, "touch");
	now = 70;
	r.record("up", "right", 2, "touch");
	now = 80;
	r.record("click", "right", 2, "touch");
	expect(r.result()).toMatchObject({
		downs: 2,
		ups: 2,
		clicks: 2,
		both_clicked: true,
		median_down_to_click_ms: 30,
		median_up_to_click_ms: 10,
		last_click_gap_ms: 50,
		pointer_types: "touch",
	});
});
it("keeps cancelled or unmatched taps visible without fabricating click latency", () => {
	const r = new TouchRecorder();
	r.record("down", "left", 1, "touch");
	r.record("cancel", "left", 1, "touch");
	r.record("click", "right", undefined, "", 0);
	expect(r.result()).toMatchObject({
		downs: 1,
		cancels: 1,
		clicks: 1,
		both_clicked: false,
		matched_clicks: 0,
		median_down_to_click_ms: null,
	});
});
it("correlates mouse-style click events only with an unambiguous same-card gesture", () => {
	const r = new TouchRecorder();
	r.record("down", "single", 1, "mouse");
	r.record("up", "single", 1, "mouse");
	r.record("click", "single", undefined, "");
	expect(r.result().matched_clicks).toBe(1);
});
