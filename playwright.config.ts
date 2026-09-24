import { defineConfig, devices, type Project } from "@playwright/test";
import ports from "./local-ports.json" with { type: "json" };
const container = process.env.E2E_SERVER === "container";
if (process.env.E2E_SERVER && !container) throw new Error("Unknown E2E_SERVER");
// CI runs each browser in its own job; locally both run unless one is named.
const browser = process.env.E2E_BROWSER;
if (browser && browser !== "chromium" && browser !== "webkit")
	throw new Error("Unknown E2E_BROWSER");
const projects: Project[] = [
	{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
	{
		name: "webkit",
		use: { ...devices["iPad Pro 11"], defaultBrowserType: "webkit" },
	},
];
export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 60000,
	expect: { timeout: 10000 },
	// One retry keeps a flake from forcing a full rerun; the report still marks it flaky.
	retries: process.env.CI ? 1 : 0,
	forbidOnly: !!process.env.CI,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		actionTimeout: 10000,
		navigationTimeout: 10000,
		baseURL: `http://127.0.0.1:${container ? ports.server : ports.preview}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: container
		? undefined
		: {
				command: "bun run preview",
				url: `http://127.0.0.1:${ports.preview}`,
				reuseExistingServer: false,
				timeout: 30000,
			},
	projects: projects.filter((project) => !browser || project.name === browser),
});
