/**
 * FloatingSettingsButton - Fixed position settings button (bottom right)
 *
 * Only visible when fullscreen mode is available
 */

interface FloatingSettingsButtonProps {
	onClick: () => void;
	visible: boolean;
}

export const FloatingSettingsButton = ({
	onClick,
	visible,
}: FloatingSettingsButtonProps) => {
	if (!visible) return null;

	return (
		<button
			type="button"
			onClick={onClick}
			className="fixed bottom-5 right-5 z-30 p-3 text-base font-semibold bg-gray-500 hover:bg-gray-600 text-white rounded-lg shadow-md transition-all duration-200 transform hover:scale-105"
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
	);
};
