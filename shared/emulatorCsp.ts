// Firebase RTDB can reconnect through script-based long polling after a socket
// failure. Permit that local transport while keeping every origin on loopback.
export const emulatorCsp =
	"default-src 'self'; script-src 'self' 'unsafe-inline' http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:; worker-src 'self' blob:";
