import { useState, useEffect } from "react";
import screenfull from "screenfull";
export function useFullscreen() {
	const [isFullscreen, setIsFullscreen] = useState(false);
	// Handle fullscreen change
	useEffect(() => {
		const handleFullscreenChange = () => {
			setIsFullscreen(screenfull.isFullscreen);
		};

		if (screenfull.isEnabled) {
			screenfull.on("change", handleFullscreenChange);
			return () => {
				screenfull.off("change", handleFullscreenChange);
			};
		}
	}, []);

	// Prevent scrolling when in fullscreen mode
	useEffect(() => {
		if (!isFullscreen) {
			// Restore normal scrolling when exiting fullscreen
			document.documentElement.style.position = "";
			document.documentElement.style.overflow = "";
			document.documentElement.style.width = "";
			document.documentElement.style.height = "";
			document.body.style.position = "";
			document.body.style.overflow = "";
			document.body.style.width = "";
			document.body.style.height = "";
			document.body.style.touchAction = "";
			return;
		}

		// Prevent scrolling in fullscreen
		const html = document.documentElement;
		const body = document.body;

		// Store original values
		const scrollY = window.scrollY;

		// Apply styles to prevent scrolling
		html.style.position = "fixed";
		html.style.overflow = "hidden";
		html.style.width = "100%";
		html.style.height = "100%";
		html.style.top = `-${scrollY}px`;

		body.style.position = "fixed";
		body.style.overflow = "hidden";
		body.style.width = "100%";
		body.style.height = "100%";
		body.style.top = `-${scrollY}px`;
		body.style.touchAction = "none";

		// Prevent touchmove events that could cause scrolling (except on interactive elements)
		const preventScroll = (e: TouchEvent) => {
			const target = e.target as HTMLElement;
			// Allow touchmove on cards and other interactive elements
			if (
				target.closest("[data-allow-touchmove]") ||
				target.closest("button") ||
				target.closest("input") ||
				target.closest("textarea") ||
				target.closest('[role="button"]')
			) {
				return;
			}
			e.preventDefault();
		};

		document.addEventListener("touchmove", preventScroll, { passive: false });

		return () => {
			// Restore scrolling
			html.style.position = "";
			html.style.overflow = "";
			html.style.width = "";
			html.style.height = "";
			html.style.top = "";

			body.style.position = "";
			body.style.overflow = "";
			body.style.width = "";
			body.style.height = "";
			body.style.top = "";
			body.style.touchAction = "";

			// Restore scroll position
			window.scrollTo(0, scrollY);

			document.removeEventListener("touchmove", preventScroll);
		};
	}, [isFullscreen]);

	const toggleFullscreen = () => {
		if (screenfull.isEnabled) {
			screenfull.toggle();
		}
	};

	return { isFullscreen, toggleFullscreen };
}
