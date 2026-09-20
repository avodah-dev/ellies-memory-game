import { useLayoutEffect } from "react";
import type { Card } from "../../types";
import { appliedCards, cardFields } from "./gameplay";
import { counters, track } from "./core";
export function usePaintProbe(cards: Card[]) {
	useLayoutEffect(() => {
		const applied = appliedCards(cards),
			fields = cardFields(cards);
		const scheduled = performance.now();
		let done = false;
		let channel: MessageChannel | null = null;
		const props = { ...fields, apply_id: applied?.id ?? null };
		const frame = requestAnimationFrame(() => {
			channel = new MessageChannel();
			channel.port1.onmessage = () => {
				done = true;
				track("mm.render.painted", {
					...props,
					phase: "after-frame-task",
					ms_apply_to_paint: applied ? performance.now() - applied.at : null,
					ms_layout_to_task: performance.now() - scheduled,
					card_renders: counters.cardRenders,
					board_renders: counters.boardRenders,
					model_publishes: counters.modelPublishes,
				});
				channel?.port1.close();
				channel?.port2.close();
			};
			channel.port2.postMessage(null);
		});
		return () => {
			cancelAnimationFrame(frame);
			channel?.port1.close();
			channel?.port2.close();
			if (!done)
				track("mm.render.painted", {
					...props,
					phase: "cancelled-before-task",
					ms_apply_to_paint: null,
					ms_layout_to_task: performance.now() - scheduled,
				});
		};
	}, [cards]);
}
