import type { FirestoreSettings } from "firebase/firestore";

// Firebase 12.6 supports this setting but omits it from the public interface.
// Safari can withhold streaming updates until the 30-second keep-alive:
// https://github.com/firebase/firebase-js-sdk/issues/9789
type TransportSettings = FirestoreSettings & { useFetchStreams: boolean };

export const firestoreTransport = {
	name: "long-polling-xhr",
	settings: {
		experimentalForceLongPolling: true,
		useFetchStreams: false,
	} satisfies TransportSettings,
} as const;
