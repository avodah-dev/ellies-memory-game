import { fileURLToPath } from "node:url";
import { createServer, configFromEnvironment } from "./app";
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error("PORT is required and must be a valid TCP port");
const commit = process.env.APP_COMMIT;
if (!commit) throw new Error("APP_COMMIT is required");
const app = await createServer({
	root: fileURLToPath(new URL("../dist", import.meta.url)),
	config: configFromEnvironment(process.env),
	commit,
	logger: true,
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, () => {
		void app
			.close()
			.then(() => process.exit(0))
			.catch((error) => {
				app.log.error(error);
				process.exit(1);
			});
	});
await app.listen({ host: "0.0.0.0", port });
