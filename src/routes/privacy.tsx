import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});

export function PrivacyPage() {
	return (
		<div className="min-h-screen bg-white">
			<div className="max-w-3xl mx-auto px-6 py-12">
				<Link
					to="/"
					className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-8"
				>
					<ArrowLeft className="w-4 h-4" />
					Back to game
				</Link>

				<h1 className="text-3xl font-bold text-gray-900 mb-8">
					Privacy Policy
				</h1>

				<div className="prose prose-gray max-w-none space-y-6">
					<p className="text-sm text-gray-500">Last updated: September 2026</p>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Overview
						</h2>
						<p className="text-gray-600">
							Matchimus is committed to protecting your privacy. This policy
							explains what information we collect, how we use it, and your
							choices regarding your data.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Information We Collect
						</h2>

						<h3 className="text-lg font-medium text-gray-700 mt-6 mb-3">
							Player Names
						</h3>
						<p className="text-gray-600">
							You may enter player names of your choosing when playing the game.
							These names are:
						</p>
						<ul className="list-disc list-inside text-gray-600 mt-2 space-y-1">
							<li>Stored locally on your device for convenience</li>
							<li>
								Shared with other players during online multiplayer sessions
							</li>
							<li>Not used for any other purpose</li>
						</ul>

						<h3 className="text-lg font-medium text-gray-700 mt-6 mb-3">
							Game Preferences
						</h3>
						<p className="text-gray-600">
							Your game settings (card packs, backgrounds, display preferences)
							are stored locally on your device using your browser's
							localStorage. Online room settings are also shared with your
							opponent through Firebase.
						</p>

						<h3 className="text-lg font-medium text-gray-700 mt-6 mb-3">
							Online Multiplayer
						</h3>
						<p className="text-gray-600">
							When you play online, we use Firebase services to enable
							multiplayer functionality:
						</p>
						<ul className="list-disc list-inside text-gray-600 mt-2 space-y-1">
							<li>
								<strong>Anonymous Authentication:</strong> A randomly generated
								anonymous ID is created for your session. No personal
								information is required.
							</li>
							<li>
								<strong>Game Data:</strong> Room codes, player presence, and
								game state are temporarily stored to synchronize gameplay
								between players.
							</li>
							<li>
								<strong>Player Names:</strong> The names you enter are shared
								with other players in your game session.
							</li>
						</ul>
						<p className="text-gray-600 mt-2">
							Online game data is temporary and is automatically cleaned up
							after sessions end.
						</p>

						<h3 className="text-lg font-medium text-gray-700 mt-6 mb-3">
							Analytics
						</h3>
						<p className="text-gray-600">
							We use PostHog analytics and diagnostics to help us improve the
							game and debug issues. This includes:
						</p>
						<ul className="list-disc list-inside text-gray-600 mt-2 space-y-1">
							<li>Page views and general usage patterns</li>
							<li>Error reports and crash data</li>
							<li>Device type and browser information</li>
							<li>
								A random device ID saved in localStorage and a new ID for each
								page session
							</li>
							<li>
								Diagnostic timings and connection information tagged with room
								code and anonymous multiplayer ID
							</li>
						</ul>
						<p className="text-gray-600 mt-2">
							PostHog receives your IP address. General usage analytics may
							derive an approximate location from it, including city, postal
							code and estimated coordinates. We disable this location
							enrichment for diagnostic events; their request IP address may
							still be retained. We do not request access to your device’s
							location sensors.
						</p>
						<p className="text-gray-600 mt-2">
							Diagnostic events do not include player names. Analytics run in
							preview and production, and are relayed through the app’s own
							domain to PostHog’s US service. Local emulator development stores
							diagnostics only in IndexedDB and sends no analytics. The random
							device ID helps us compare sessions; it is not a device
							fingerprint.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							What We Don't Collect
						</h2>
						<ul className="list-disc list-inside text-gray-600 space-y-1">
							<li>Email addresses or contact information</li>
							<li>Payment information (the game is free)</li>
							<li>GPS or device location sensor data</li>
							<li>Social media profiles</li>
							<li>Account profiles or a device fingerprint</li>
						</ul>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Data Storage
						</h2>
						<ul className="list-disc list-inside text-gray-600 space-y-1">
							<li>
								<strong>Local Storage:</strong> Your device stores game
								preferences, a random device ID and a local diagnostic log.
								Reload App preserves this data; clearing site storage removes
								it.
							</li>
							<li>
								<strong>Firebase:</strong> Online game data is stored in Google
								Cloud infrastructure (US region). Temporary session data is
								automatically cleaned up.
							</li>
							<li>
								<strong>PostHog:</strong> Analytics data is stored in PostHog's
								US cloud infrastructure.
							</li>
						</ul>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Your Choices
						</h2>
						<ul className="list-disc list-inside text-gray-600 space-y-1">
							<li>
								<strong>Clear Local Data:</strong> You can clear your browser's
								site storage to remove saved preferences, the device ID and
								local diagnostic logs. A new device ID is generated next time
								you open the app.
							</li>
							<li>
								<strong>Player Names:</strong> You can change your player name
								at any time in the game settings.
							</li>
							<li>
								<strong>Online Play:</strong> Playing locally doesn't require
								any cloud services; only online multiplayer uses Firebase.
							</li>
						</ul>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Children's Privacy
						</h2>
						<p className="text-gray-600">
							Matchimus is designed to be family-friendly. We do not knowingly
							collect personal information from children. The game requires no
							account creation. The storage and diagnostics described above also
							apply when children use the app.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Changes to This Policy
						</h2>
						<p className="text-gray-600">
							We may update this Privacy Policy from time to time. Any changes
							will be reflected on this page with an updated "Last updated"
							date.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">
							Contact
						</h2>
						<p className="text-gray-600">
							For questions or concerns about this Privacy Policy, please
							contact us at{" "}
							<a
								href="mailto:contact@avodah.dev"
								className="text-blue-600 hover:underline"
							>
								contact@avodah.dev
							</a>
						</p>
					</section>
				</div>

				<div className="mt-12 pt-8 border-t border-gray-200">
					<Link
						to="/"
						className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
					>
						<ArrowLeft className="w-4 h-4" />
						Back to game
					</Link>
				</div>
			</div>
		</div>
	);
}
