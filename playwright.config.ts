import { defineConfig, devices } from "@playwright/test";
import ports from "./local-ports.json" with { type: "json" };
const container = process.env.E2E_SERVER === "container";
if (process.env.E2E_SERVER && !container) throw new Error("Unknown E2E_SERVER");
export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 60000,
	expect: { timeout: 10000 },
	retries: 0,
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
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{
			name: "webkit",
			use: { ...devices["iPad Pro 11"], defaultBrowserType: "webkit" },
		},
	],
});
