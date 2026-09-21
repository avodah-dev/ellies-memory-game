import { expect, it } from "vitest";
import { isCardImageSource } from "./cardImage";

it.each([
	"https://images.example/card",
	"http://images.example/card",
	"/images/card",
	"card.PNG",
	"card.jpeg",
	"card.jpg",
	"card.gif",
	"card.webp",
	"blob:http://localhost/card",
	"data:image/png;base64,AA==",
])("recognizes the existing picture source format %s", (source) => {
	expect(isCardImageSource(source)).toBe(true);
});

it.each([undefined, "", "🐱", "A", "not-an-image"])(
	"keeps non-image content %s as text",
	(source) => {
		expect(isCardImageSource(source)).toBe(false);
	},
);
