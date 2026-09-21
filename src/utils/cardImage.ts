// Keep picture-versus-emoji classification identical on the board and in previews.
export function isCardImageSource(url: string | undefined): boolean {
	return Boolean(
		url &&
			(url.startsWith("http") ||
				url.startsWith("/") ||
				url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
				url.includes("blob:") ||
				url.includes("data:")),
	);
}
