// Input behavior is independent of telemetry. Each mounted button owns its contacts.
export interface CardPointer {
	pointerId: number;
	pointerType: string;
	button: number;
	clientX: number;
	clientY: number;
}
export interface CardClick {
	detail: number;
	nativeEvent: MouseEvent;
}
export interface CardGesture {
	id: string;
	pointerId: number;
	type: string;
	at: number;
	ended: number | null;
	x: number;
	y: number;
	cancelled: boolean;
	handled: boolean;
	inputId: string | null;
}
export interface ClickDecision {
	activate: boolean;
	type: string;
	gesture: CardGesture | null;
	association: "pointer-id" | "released-contact" | "ambiguous" | "none";
}
const direct = (type: string) => type === "touch" || type === "pen";
let gestureSerial = 0;

export function createCardInput(now = () => performance.now()) {
	const gestures = new Map<number, CardGesture>();
	let lastPointerType = "";
	const prune = () => {
		for (const [id, gesture] of gestures)
			if (gesture.ended !== null && now() - gesture.ended > 1500)
				gestures.delete(id);
	};
	return {
		down(event: CardPointer): CardGesture {
			prune();
			lastPointerType = event.pointerType;
			// Bound metadata even if a browser never delivers up/cancel.
			if (gestures.size >= 16) gestures.delete(gestures.keys().next().value!);
			const gesture: CardGesture = {
				id: String(++gestureSerial),
				pointerId: event.pointerId,
				type: event.pointerType,
				at: now(),
				ended: null,
				x: event.clientX,
				y: event.clientY,
				cancelled: false,
				handled: direct(event.pointerType) && event.button === 0,
				inputId: null,
			};
			gestures.set(event.pointerId, gesture);
			return gesture;
		},
		end(event: CardPointer, cancelled: boolean): CardGesture | null {
			const gesture = gestures.get(event.pointerId);
			if (!gesture) return null;
			gesture.ended = now();
			gesture.x = event.clientX;
			gesture.y = event.clientY;
			gesture.cancelled = cancelled;
			return gesture;
		},
		click(event: CardClick): ClickDecision {
			prune();
			const native = event.nativeEvent as MouseEvent &
				Partial<PointerEvent> & {
					sourceCapabilities?: { firesTouchEvents: boolean } | null;
				};
			const declaredType = native.sourceCapabilities?.firesTouchEvents
				? "touch"
				: native.pointerType || "";
			// Native keyboard/assistive clicks are independent of prior contacts.
			if (event.detail === 0 && !direct(declaredType))
				return {
					activate: true,
					type: "keyboard",
					gesture: null,
					association: "none",
				};
			const type = declaredType || lastPointerType || "unknown";
			let gesture =
				typeof native.pointerId === "number"
					? (gestures.get(native.pointerId) ?? null)
					: null;
			let association: ClickDecision["association"] = gesture
				? "pointer-id"
				: "none";
			if (gesture && gesture.type !== type) {
				gesture = null;
				association = "none";
			}
			if (!gesture) {
				// WebKit can deliver a MouseEvent or a click with an unrelated ID.
				// Associate only one recent released contact at these coordinates.
				const candidates = [...gestures.values()].filter(
					(g) =>
						g.type === type &&
						!g.cancelled &&
						g.ended !== null &&
						Math.abs(g.x - native.clientX) <= 2 &&
						Math.abs(g.y - native.clientY) <= 2,
				);
				if (candidates.length === 1) {
					gesture = candidates[0];
					association = "released-contact";
				} else if (candidates.length > 1) association = "ambiguous";
			}
			if (gesture) gestures.delete(gesture.pointerId);
			// Direct contacts were already attempted on down, even if rejected by
			// game rules. A later click must not retry the move in a different turn.
			// A real mouse down replaces lastPointerType; no time-based click ban.
			return { activate: !direct(type), type, gesture, association };
		},
	};
}
