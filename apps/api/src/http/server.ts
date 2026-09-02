import "dotenv/config";
import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535");

const app = buildApp({ logger: true });

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down SettleGuard API");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
