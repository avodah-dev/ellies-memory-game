import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { ConnectionTestPanel } from "./ConnectionTestModal";
vi.mock("../services/diagnostics/browserProbes", () => ({
	httpProbe: vi.fn().mockResolvedValue({ samples: 9, failures: 0 }),
	transportProbe: vi.fn().mockResolvedValue({ observation: "not-observed" }),
	networkProbe: vi.fn().mockResolvedValue({ supported: false }),
	frameProbe: vi.fn().mockResolvedValue({ samples: 100 }),
}));
vi.mock("../services/diagnostics/firebaseProbes", () => ({
	firestoreProbe: vi.fn().mockResolvedValue({ samples: 5 }),
	rtdbProbe: vi.fn().mockResolvedValue({ samples: 5 }),
}));
vi.mock("../services/telemetry/core", () => ({
	getContext: () => ({ room_code: null }),
	track: vi.fn(),
}));
import { httpProbe } from "../services/diagnostics/browserProbes";
beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	vi.mocked(httpProbe).mockResolvedValue({ samples: 9, failures: 0 });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("shows progress, accepts tap probes and copies the completed report", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	render(<ConnectionTestPanel onClose={() => {}} />);
	fireEvent.click(screen.getByRole("button", { name: "Start test" }));
	const tap = await screen.findByRole("button", { name: "Tap" });
	for (let i = 0; i < 5; i++) fireEvent.click(tap);
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	for (let pair = 1; pair <= 3; pair++) {
		await screen.findByText(`B: Tap left then right fast — pair ${pair} of 3`);
		fireEvent.click(screen.getByRole("button", { name: "Left" }));
		fireEvent.click(screen.getByRole("button", { name: "Right" }));
		fireEvent.click(screen.getByRole("button", { name: "Continue pair" }));
	}
	await screen.findByText("Test complete");
	fireEvent.click(screen.getByRole("button", { name: "Copy results" }));
	await screen.findByText("Copied results");
	expect(JSON.parse(writeText.mock.calls[0][0]).results).toHaveLength(8);
});
it("close cancels a pending request and never reaches the interactive tests", async () => {
	let signal: AbortSignal | undefined;
	vi.mocked(httpProbe).mockImplementation((s) => {
		signal = s;
		return new Promise(() => {});
	});
	const close = vi.fn();
	render(<ConnectionTestPanel onClose={close} />);
	fireEvent.click(screen.getByRole("button", { name: "Start test" }));
	await waitFor(() => expect(signal).toBeDefined());
	fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
	expect(close).toHaveBeenCalledOnce();
	expect(signal?.aborted).toBe(true);
	await screen.findByText("Test cancelled");
});
it("allows optional tap probes to be skipped without inventing measurements", async () => {
	render(<ConnectionTestPanel onClose={() => {}} />);
	fireEvent.click(screen.getByRole("button", { name: "Start test" }));
	fireEvent.click(await screen.findByRole("button", { name: "Skip tap test" }));
	await screen.findByText("B: Tap left then right fast — pair 1 of 3");
	fireEvent.click(screen.getByRole("button", { name: "Skip tap test" }));
	await screen.findByText("Test complete");
	expect(screen.getAllByText("Skipped.")).toHaveLength(2);
});
