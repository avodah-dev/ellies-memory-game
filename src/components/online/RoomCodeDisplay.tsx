/**
 * RoomCodeDisplay - Large display of room code for sharing
 */

import { useState } from "react";

interface RoomCodeDisplayProps {
	roomCode: string;
	className?: string;
}

export const RoomCodeDisplay = ({
	roomCode,
	className = "",
}: RoomCodeDisplayProps) => {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(roomCode);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	return (
		<div className={`text-center ${className}`}>
			<p className="text-sm text-gray-600 mb-2">Room Code</p>
			<button
				type="button"
				onClick={handleCopy}
				className="group relative bg-gray-100 hover:bg-gray-200 rounded-xl px-6 py-4 transition-colors"
				title="Click to copy"
			>
				<div className="flex items-center gap-3">
					<span
						data-testid="room-code"
						className="text-4xl font-mono font-bold tracking-widest text-gray-800"
					>
						{roomCode}
					</span>
					<svg
						className="w-6 h-6 text-gray-500 group-hover:text-gray-700 transition-colors"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<title>{copied ? "Copied" : "Copy"}</title>
						{copied ? (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M5 13l4 4L19 7"
							/>
						) : (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						)}
					</svg>
				</div>
				{copied && (
					<span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-sm text-green-600 font-medium">
						Copied!
					</span>
				)}
			</button>
			<p className="text-xs text-gray-500 mt-4">
				Share this code with your friend to join
			</p>
		</div>
	);
};
