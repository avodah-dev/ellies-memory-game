import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useUIStore } from "../stores/uiStore";
import { getDeviceIdentity } from "../services/telemetry/identity";
import { getRuntimeConfig } from "../lib/runtimeConfig";
import {
	bounded,
	ProbeError,
	runConnectionTest,
	type Metrics,
	type TestName,
	type TestResult,
} from "../services/diagnostics/connectionTest";
import {
	httpProbe,
	transportProbe,
	networkProbe,
	frameProbe,
} from "../services/diagnostics/browserProbes";
import {
	firestoreProbe,
	rtdbProbe,
} from "../services/diagnostics/firebaseProbes";
import {
	TouchRecorder,
	type TouchPhase,
} from "../services/diagnostics/touchProbe";

const labels: Record<TestName, string> = {
	http: "Web connection",
	firestore: "Game service read",
	rtdb: "Realtime connection",
	transport: "Game connection transport",
	network: "Browser network estimate",
	frames: "Frame smoothness",
	touch_a: "Single-card taps",
	touch_b: "Fast left–right taps",
};
interface Prompt {
	recorder: TouchRecorder;
	kind: "a" | "b";
	pair: number;
	finish: (skip: boolean) => void;
}
const format = (value: unknown) =>
	typeof value === "number"
		? `${Math.round(value * 10) / 10} ms`
		: "Unavailable";
function summary(result: TestResult) {
	const m = result.metrics;
	if (result.status === "timeout")
		return "Timed out. You can run the test again.";
	if (result.status === "cancelled") return "Cancelled.";
	if (result.status === "skipped") return "Skipped.";
	if (result.status === "error")
		return `Could not complete this test${typeof m.failures === "number" ? ` (${m.failures} failed attempt${m.failures === 1 ? "" : "s"})` : ""}.`;
	switch (result.test) {
		case "http":
			return `First ping ${format(m.first_ping_ms)} · warm min ${format(m.min_ms)} · median ${format(m.median_ms)} · p95 ${format(m.p95_ms)} · jitter ${format(m.jitter_ms)} · ${m.failures} failures. Device clock correction ${format(m.measured_http_offset_ms)} (server minus device).`;
		case "firestore":
			return `${m.samples} reads · median ${format(m.median_ms)} · p95 ${format(m.p95_ms)}.`;
		case "rtdb":
			return `${m.samples} acknowledged writes · median ${format(m.median_ms)} · p95 ${format(m.p95_ms)}. Device clock correction ${format(m.measured_rtdb_offset_ms)}.`;
		case "transport":
			return m.observation === "not-observed"
				? "No completed game-listener requests observed. Transport is unknown."
				: `${m.listen_entries} completed listener requests; ${m.polling_hints} polling hints. Informational only; this cannot prove the current transport.`;
		case "network":
			return m.supported
				? `${m.effective_type ?? "Unknown type"} · estimated latency ${format(m.estimated_rtt_ms)} · ${m.downlink_mbps ?? "Unknown"} Mbps. Browser estimate, not a measured connection speed.`
				: "This browser does not expose network estimates (normal on Safari).";
		case "frames":
			return `${m.samples} frame intervals · p95 ${format(m.p95_ms)} · longest ${format(m.max_ms)} · ${m.gt_100} over 100 ms.`;
		case "touch_a":
			return `${m.downs} downs / ${m.ups} ups / ${m.clicks} clicks / ${m.cancels} cancels. Down-to-click median ${format(m.median_down_to_click_ms)}. Input: ${m.pointer_types || "none"}.`;
		case "touch_b":
			return `${m.completed_pairs} pairs recorded; both clicks registered in ${m.both_clicked_pairs}. See copied results for each pair’s timing and input type.`;
	}
}
export function ConnectionTestModal() {
	const isOpen = useUIStore((s) => s.showConnectionTest);
	const setOpen = useUIStore((s) => s.setShowConnectionTest);
	return isOpen ? <ConnectionTestPanel onClose={() => setOpen(false)} /> : null;
}
export function ConnectionTestPanel({ onClose }: { onClose: () => void }) {
	const [results, setResults] = useState<TestResult[]>([]);
	const [current, setCurrent] = useState<TestName | null>(null);
	const [running, setRunning] = useState(false);
	const [finished, setFinished] = useState<string | null>(null);
	const [copied, setCopied] = useState("");
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const [counts, setCounts] = useState<Metrics>({});
	const active = useRef<AbortController | null>(null);
	const promptElement = useRef<HTMLDivElement>(null);
	const lastReport = useRef<unknown>(null);
	useEffect(
		() => () => {
			active.current?.abort();
		},
		[],
	);
	useEffect(() => {
		if (prompt) promptElement.current?.scrollIntoView({ block: "nearest" });
	}, [prompt]);
	const askTouch = (kind: "a" | "b", pair: number, signal: AbortSignal) =>
		new Promise<Metrics>((resolve, reject) => {
			const recorder = new TouchRecorder();
			const cleanup = () => {
				signal.removeEventListener("abort", abort);
				setPrompt((value) => (value?.recorder === recorder ? null : value));
			};
			const abort = () => {
				cleanup();
				reject(new ProbeError("cancelled"));
			};
			const finish = (skip: boolean) => {
				const metrics = recorder.result();
				cleanup();
				resolve({ ...metrics, skipped: skip });
			};
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) {
				abort();
				return;
			}
			setCounts({});
			setPrompt({ recorder, kind, pair, finish });
		});
	const start = async () => {
		if (active.current) return;
		const controller = new AbortController();
		active.current = controller;
		setResults([]);
		setFinished(null);
		setCopied("");
		setRunning(true);
		try {
			const report = await runConnectionTest({
				signal: controller.signal,
				deps: {
					http: httpProbe,
					firestore: firestoreProbe,
					rtdb: rtdbProbe,
					transport: transportProbe,
					network: networkProbe,
					frames: frameProbe,
					touch_a: (signal) => askTouch("a", 1, signal),
					touch_b: async (signal) => {
						const metrics: Metrics = {
							completed_pairs: 0,
							both_clicked_pairs: 0,
						};
						for (let pair = 1; pair <= 3; pair++) {
							const result = await bounded(signal, 30000, (scope) =>
								askTouch("b", pair, scope),
							);
							if (result.skipped) return { ...metrics, skipped: true };
							metrics.completed_pairs = pair;
							metrics.both_clicked_pairs =
								Number(metrics.both_clicked_pairs) +
								(result.both_clicked ? 1 : 0);
							for (const [key, value] of Object.entries(result))
								metrics[`pair_${pair}_${key}`] = value;
						}
						return metrics;
					},
				},
				onProgress: (progress) => {
					setCurrent(progress.test);
					if (progress.result)
						setResults((previous) => [...previous, progress.result!]);
				},
			});
			lastReport.current = {
				device: getDeviceIdentity().id,
				environment: getRuntimeConfig().environment,
				...report,
			};
			setFinished(report.cancelled ? "Test cancelled" : "Test complete");
		} finally {
			active.current = null;
			setRunning(false);
			setCurrent(null);
		}
	};
	const record = (
		phase: TouchPhase,
		side: string,
		event:
			| React.PointerEvent<HTMLButtonElement>
			| React.MouseEvent<HTMLButtonElement>,
	) => {
		if (!prompt) return;
		const pointer = event.nativeEvent as PointerEvent;
		prompt.recorder.record(
			phase,
			side,
			typeof pointer.pointerId === "number" ? pointer.pointerId : undefined,
			pointer.pointerType ?? "",
			event.detail,
		);
		setCounts(prompt.recorder.result());
	};
	const card = (side: string, label: string) => (
		<button
			type="button"
			aria-label={label}
			onPointerDown={(e) => record("down", side, e)}
			onPointerUp={(e) => record("up", side, e)}
			onPointerCancel={(e) => record("cancel", side, e)}
			onClick={(e) => record("click", side, e)}
			className="w-28 h-36 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-2xl font-bold shadow-lg select-none focus-visible:ring-4 focus-visible:ring-purple-300"
		>
			{label}
		</button>
	);
	return (
		<Modal
			isOpen
			onClose={() => {
				active.current?.abort();
				onClose();
			}}
			title="Connection test"
		>
			<div className="space-y-5 text-gray-800">
				<p className="text-sm text-gray-600">
					Device {getDeviceIdentity().label} · Checks your connection, frame
					timing and taps. Your game continues while this panel is open.
				</p>
				<p className="text-sm text-gray-600">
					Results are saved locally
					{getRuntimeConfig().environment !== "emulator" &&
					getRuntimeConfig().telemetry === "on"
						? " and sent with your device ID for diagnostics"
						: ""}
					. Automatic checks are followed by two optional tap tests.
				</p>
				<div className="flex flex-wrap gap-3">
					<button
						type="button"
						disabled={running}
						onClick={() => void start()}
						className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
					>
						{finished ? "Run again" : "Start test"}
					</button>
					{running && (
						<button
							type="button"
							onClick={() => active.current?.abort()}
							className="px-4 py-2 rounded-lg bg-gray-200"
						>
							Cancel test
						</button>
					)}
					{finished && (
						<button
							type="button"
							onClick={() => {
								if (!navigator.clipboard) {
									setCopied("Copy unavailable in this browser");
									return;
								}
								void navigator.clipboard
									.writeText(JSON.stringify(lastReport.current, null, 2))
									.then(
										() => setCopied("Copied results"),
										() => setCopied("Copy unavailable in this browser"),
									);
							}}
							className="px-4 py-2 rounded-lg bg-gray-200"
						>
							Copy results
						</button>
					)}
				</div>
				<p role="status" className="font-medium">
					{copied ||
						(current
							? `Testing: ${labels[current]}`
							: (finished ?? "Ready to test"))}
				</p>
				{prompt && (
					<div
						ref={promptElement}
						className="rounded-xl border-2 border-purple-300 bg-purple-50 p-4 space-y-4"
					>
						<h3 className="font-bold">
							{prompt.kind === "a"
								? "A: Tap the card five times"
								: `B: Tap left then right fast — pair ${prompt.pair} of 3`}
						</h3>
						<p className="text-sm">
							{prompt.kind === "a"
								? "Use your normal finger or mouse taps, then choose Continue."
								: "After the two quick taps, choose Continue pair, even if a click did not register."}
						</p>
						<div className="flex gap-6 justify-center">
							{prompt.kind === "a" ? (
								card("single", "Tap")
							) : (
								<>
									{card("left", "Left")}
									{card("right", "Right")}
								</>
							)}
						</div>
						<p className="text-sm">
							Downs: {counts.downs ?? 0} · Clicks: {counts.clicks ?? 0} ·
							Cancels: {counts.cancels ?? 0}
						</p>
						<div className="flex gap-3">
							<button
								type="button"
								onClick={() => prompt.finish(false)}
								className="rounded-lg px-4 py-2 bg-indigo-600 text-white"
							>
								{prompt.kind === "a" ? "Continue" : "Continue pair"}
							</button>
							<button
								type="button"
								onClick={() => prompt.finish(true)}
								className="rounded-lg px-4 py-2 bg-white border"
							>
								Skip tap test
							</button>
						</div>
					</div>
				)}
				<ol className="space-y-3">
					{results.map((result) => (
						<li
							key={result.test}
							className="rounded-lg border border-gray-200 p-3"
						>
							<h3 className="font-semibold">
								{labels[result.test]}{" "}
								<span className="text-sm font-normal">({result.status})</span>
							</h3>
							<p className="text-sm text-gray-600 mt-1">{summary(result)}</p>
						</li>
					))}
				</ol>
			</div>
		</Modal>
	);
}
