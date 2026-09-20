export const DEVICE_ID_KEY = "matchimus-device-id";
export interface DeviceIdentity {
	id: string;
	label: string;
	persisted: boolean;
	isNew: boolean;
}
let identity: DeviceIdentity | undefined;
let session: string | undefined;
export function getDeviceIdentity(): DeviceIdentity {
	if (identity) return identity;
	let id: string | null = null;
	let persisted = false;
	let isNew = false;
	try {
		id = localStorage.getItem(DEVICE_ID_KEY);
		if (
			!id ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				id,
			)
		) {
			id = crypto.randomUUID();
			isNew = true;
			localStorage.setItem(DEVICE_ID_KEY, id);
		}
		persisted = true;
	} catch {
		// Explicit session-only identity when storage is unavailable.
		if (!id) id = crypto.randomUUID();
		isNew = true;
	}
	identity = { id, label: id.slice(-4).toUpperCase(), persisted, isNew };
	return identity;
}
export function getPageSessionId(): string {
	session ??= crypto.randomUUID();
	return session;
}
export function collectDeviceTraits() {
	return {
		user_agent: navigator.userAgent,
		language: navigator.language,
		hardware_concurrency: navigator.hardwareConcurrency,
		max_touch_points: navigator.maxTouchPoints,
		screen_width: screen.width,
		screen_height: screen.height,
		pixel_ratio: devicePixelRatio,
		standalone: matchMedia("(display-mode: standalone)").matches,
	};
}
export function resetIdentityForTests() {
	identity = undefined;
	session = undefined;
}
