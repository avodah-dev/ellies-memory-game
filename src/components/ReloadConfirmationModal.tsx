/**
 * ReloadConfirmationModal - Confirmation dialog for app reload
 */

interface ReloadConfirmationModalProps {
	onCancel: () => void;
	onConfirm: () => void;
	isReloading: boolean;
	error?: string | null;
}

export const ReloadConfirmationModal = ({
	onCancel,
	onConfirm,
	isReloading,
	error,
}: ReloadConfirmationModalProps) => {
	return (
		<div className="text-center space-y-6">
			{error && (
				<p role="alert" className="text-red-700">
					{error}
				</p>
			)}
			<div>
				<div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
					<svg
						className="w-8 h-8 text-gray-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<title>Reload</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
						/>
					</svg>
				</div>
				<p className="text-gray-600">
					Clear cached app files and restart Matchimus. Your saved settings will
					stay, but your current game will end. An internet connection is
					required.
				</p>
			</div>
			<div className="flex gap-4">
				<button
					type="button"
					onClick={onCancel}
					disabled={isReloading}
					className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={isReloading}
					className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
				>
					{isReloading ? "Reloading…" : "Clear Cache & Reload"}
				</button>
			</div>
		</div>
	);
};
