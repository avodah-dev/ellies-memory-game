/**
 * SettingsSidebarWrapper - Slide-over container with backdrop for settings menu
 */

import type { ReactNode } from "react";

interface SettingsSidebarWrapperProps {
	isOpen: boolean;
	onClose: () => void;
	children: ReactNode;
}

export const SettingsSidebarWrapper = ({
	isOpen,
	onClose,
	children,
}: SettingsSidebarWrapperProps) => {
	return (
		<>
			{/* Settings Slide-over Menu */}
			<div
				aria-hidden={!isOpen}
				inert={!isOpen}
				className={`fixed top-0 right-0 h-full w-[360px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
					isOpen ? "translate-x-0" : "translate-x-full"
				}`}
			>
				{children}
			</div>

			{/* Backdrop when settings menu is open */}
			{isOpen && (
				<div
					className="fixed inset-0 bg-black bg-opacity-50 z-40"
					onClick={onClose}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							onClose();
						}
					}}
					role="button"
					tabIndex={0}
					aria-label="Close settings"
				/>
			)}
		</>
	);
};
