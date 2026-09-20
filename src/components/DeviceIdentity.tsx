import { useState } from "react";
import { getDeviceIdentity } from "../services/telemetry/identity";

export function DeviceIdentity() {
	const device = getDeviceIdentity();
	const [status, setStatus] = useState("");
	return (
		<div className="rounded-lg bg-gray-50 p-3 text-gray-800">
			<div className="flex items-center justify-between gap-3">
				<span className="font-semibold">Device {device.label}</span>
				<button
					type="button"
					className="text-blue-600 underline text-sm"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(device.id);
							setStatus("Device ID copied");
						} catch {
							setStatus("Could not copy; select the ID below");
						}
					}}
				>
					Copy device ID
				</button>
			</div>
			<code className="block break-all mt-1 text-xs select-all">
				{device.id}
			</code>
			{!device.persisted && (
				<p className="mt-1 text-xs">
					Storage unavailable; this ID lasts for this page session.
				</p>
			)}
			<span role="status" className="text-xs">
				{status}
			</span>
		</div>
	);
}
