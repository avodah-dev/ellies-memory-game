/**
 * FixedGameControls - Fixed position control buttons shown during gameplay
 *
 * Includes: Reset button, Admin toggle, Fullscreen/Settings button
 */

interface FixedGameControlsProps {
	onResetClick: () => void;
	onToggleFullscreen: () => void;
	onOpenSettings: () => void;
	onToggleAdmin: () => void;
	isFullscreen: boolean;
	adminEnabled: boolean;
	showAdminSidebar: boolean;
	screenfullEnabled: boolean;
}

export const FixedGameControls = ({
	onResetClick,
	onToggleFullscreen,
	onOpenSettings,
	onToggleAdmin,
	isFullscreen,
	adminEnabled,
	showAdminSidebar,
	screenfullEnabled,
}: FixedGameControlsProps) => {
	return (
		<>
			{/* Left side - Reset Button */}
			<div className="fixed top-5 left-5 z-30 flex flex-col gap-2">
				<button
					type="button"
					onClick={onResetClick}
					className="p-3 text-base font-semibold bg-gray-500 hover:bg-gray-600 text-white rounded-lg shadow-md transition-all duration-200 transform hover:scale-105"
					title="Reset Game"
				>
					<svg
						className="w-6 h-6"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<title>Reset Game</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				</button>

				{/* Admin Toggle Button - only show if admin is enabled */}
				{adminEnabled && (
					<button
						type="button"
						onClick={onToggleAdmin}
						className={`p-2 text-xs font-semibold rounded-lg shadow-md transition-all duration-200 transform hover:scale-105 ${
							showAdminSidebar
								? "bg-blue-500 hover:bg-blue-600 text-white"
								: "bg-gray-400 hover:bg-gray-500 text-white"
						}`}
						title={showAdminSidebar ? "Hide Admin Panel" : "Show Admin Panel"}
					>
						<svg
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<title>
								{showAdminSidebar ? "Hide Admin Panel" : "Show Admin Panel"}
							</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					</button>
				)}
			</div>

			{/* Top right - Fullscreen Button or Settings Button (if fullscreen not available) */}
			{screenfullEnabled ? (
				<button
					type="button"
					onClick={onToggleFullscreen}
					className="fixed top-5 right-5 z-30 bg-gray-600 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors duration-200"
					title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
				>
					{isFullscreen ? (
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<title>Exit Fullscreen</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
							/>
						</svg>
					) : (
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<title>Enter Fullscreen</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
							/>
						</svg>
					)}
				</button>
			) : (
				<button
					type="button"
					onClick={onOpenSettings}
					className="fixed top-5 right-5 z-30 p-3 text-base font-semibold bg-gray-500 hover:bg-gray-600 text-white rounded-lg shadow-md transition-all duration-200 transform hover:scale-105"
					title="Settings"
				>
					<svg
						className="w-6 h-6"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<title>Settings</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/>
					</svg>
				</button>
			)}
		</>
	);
};
