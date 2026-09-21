import type { RuntimeConfig } from "../../../shared/runtimeConfig";
import { track } from "./core";

interface Delivery {
	card: string | null;
	gesture: string | null;
}
const deliveries = new WeakMap<Event, Delivery>();
let serial = 0;

// Only a WeakMap lookup on the Card path; the observer owns all hit-testing.
export function markCardInput(
	event: Event,
	cardId: string,
	gestureId: string | null,
) {
	const delivery = deliveries.get(event);
	if (delivery) {
		delivery.card = cardId;
		delivery.gesture = gestureId;
	}
}
function describe(target: EventTarget | null) {
	const el = target instanceof Element ? target : null;
	const card = el?.closest("[data-card-id]");
	const id = card?.getAttribute("data-card-id") ?? "";
	return {
		tag: el?.tagName.toLowerCase() ?? null,
		card: /^card-\d+$/.test(id) ? id : null,
		board: Boolean(
			el?.closest('[role="application"][aria-label="Game board"]'),
		),
		dialog: Boolean(el?.closest('[role="dialog"], [aria-modal="true"]')),
		disabled: card instanceof HTMLButtonElement && card.disabled,
		flying: Boolean(el?.closest(".card-fly-to-player")),
	};
}

export function startInputCapture(config: RuntimeConfig) {
	if (config.telemetry !== "on") return () => {};
	let active = true;
	let dropped = 0;
	const reports = new Set<ReturnType<typeof setTimeout>>();
	const capture = (event: PointerEvent | TouchEvent) => {
		if (!/^\/(local|online)\/game$/.test(location.pathname)) return;
		if (reports.size >= 64) {
			dropped++;
			return;
		}
		try {
			const started = performance.now();
			const delivery: Delivery = { card: null, gesture: null };
			deliveries.set(event, delivery);
			const pointer =
				event.type === "pointerdown" ? (event as PointerEvent) : null;
			const touches = pointer
				? []
				: Array.from((event as TouchEvent).changedTouches);
			// One hit-test per changed contact, capped at ten; no DOM text, selectors,
			// coordinates, names or image URLs leave the browser.
			const points = pointer ? [pointer] : touches.slice(0, 10);
			const records = points.map((point) => {
				const target = describe(pointer ? event.target : point.target);
				const hit = describe(
					document.elementFromPoint(point.clientX, point.clientY),
				);
				return {
					capture_id: String(++serial),
					event_type: event.type,
					capture_mono_ms: started,
					input_id: null,
					pointer_id: pointer?.pointerId ?? null,
					touch_identifier: "identifier" in point ? point.identifier : null,
					pointer_type: pointer?.pointerType ?? "touch",
					changed_contacts: points.length,
					active_touches: pointer ? null : (event as TouchEvent).touches.length,
					is_trusted: event.isTrusted,
					target_tag: target.tag,
					target_card_id: target.card,
					target_in_board: target.board,
					target_in_dialog: target.dialog,
					target_disabled: target.disabled,
					target_flying: target.flying,
					hit_tag: hit.tag,
					hit_card_id: hit.card,
					hit_in_board: hit.board,
					hit_in_dialog: hit.dialog,
					hit_disabled: hit.disabled,
					hit_flying: hit.flying,
					default_prevented_capture: event.defaultPrevented,
				};
			});
			const cost = performance.now() - started;
			// Use a task, not a microtask: native event dispatch can run microtasks
			// between capture and React handlers. Only after propagation can a missing
			// Card handler be reported accurately. This observer never activates cards or cancels input.
			const report = setTimeout(() => {
				reports.delete(report);
				deliveries.delete(event);
				if (!active) return;
				for (const record of records)
					track("mm.input.capture", {
						...record,
						capture_dropped_total: dropped,
						card_handler_ran: delivery.card !== null,
						handler_card_id: delivery.card,
						gesture_id: delivery.gesture,
						default_prevented_after: event.defaultPrevented,
						ms_capture_work: cost,
						ms_dispatch_to_report: performance.now() - started,
					});
			}, 0);
			reports.add(report);
		} catch {
			// Diagnostics must never interfere with native input.
		}
	};
	document.addEventListener("pointerdown", capture, {
		capture: true,
		passive: true,
	});
	document.addEventListener("touchstart", capture, {
		capture: true,
		passive: true,
	});
	return () => {
		active = false;
		for (const report of reports) clearTimeout(report);
		reports.clear();
		document.removeEventListener("pointerdown", capture, true);
		document.removeEventListener("touchstart", capture, true);
	};
}
