const buildInfo = __BUILD_INFO__;
import { Modal } from "./Modal";

interface BuildInfoModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export const BuildInfoModal = ({ isOpen, onClose }: BuildInfoModalProps) => {
	// Format the build time to a readable format
	const formatBuildTime = (isoString: string) => {
		try {
			const date = new Date(isoString);
			return date.toLocaleString("en-US", {
				dateStyle: "full",
				timeStyle: "long",
			});
		} catch {
			return isoString;
		}
	};

	// Shorten the commit hash for display
	const shortCommitHash = buildInfo.commitHash.substring(0, 7);

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Build Information">
			<div className="space-y-6">
				<div className="bg-gray-50 rounded-lg p-4 space-y-4">
					{/* Build Time */}
					<div>
						<h3 className="text-sm font-semibold text-gray-600 mb-1">
							Last Build
						</h3>
						<p className="text-base text-gray-900">
							{formatBuildTime(buildInfo.buildTime)}
						</p>
					</div>

					{/* Git Commit */}
					<div>
						<h3 className="text-sm font-semibold text-gray-600 mb-1">
							Git Commit
						</h3>
						<div className="flex items-center gap-2">
							<code className="text-base font-mono bg-gray-200 px-2 py-1 rounded text-gray-900">
								{shortCommitHash}
							</code>
							<button
								type="button"
								onClick={() => {
									navigator.clipboard.writeText(buildInfo.commitHash);
								}}
								className="text-xs text-blue-600 hover:text-blue-800 underline"
								title="Copy full commit hash"
							>
								Copy Full
							</button>
						</div>
					</div>
				</div>

				{/* Close Button */}
				<div className="flex justify-end">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
					>
						Close
					</button>
				</div>
			</div>
		</Modal>
	);
};
