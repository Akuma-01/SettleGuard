import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import multipart from "@fastify/multipart";
import { registerBatchRoutes } from "./routes/batches.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerExceptionRoutes } from "./routes/exceptions.js";
import { registerReviewCaseRoutes } from "./routes/review-cases.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { configuredAgentStatus, configuredModelCaller } from "../agent/client.js";
import type { ModelCaller } from "../agent/loop.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/client.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface AppDependencies {
  modelCaller: ModelCaller;
  evidenceOutputDirectory: string;
  demoDatasetDirectory: string;
}

export function buildApp(
  options: FastifyServerOptions = { logger: false },
  dependencyOverrides: Partial<AppDependencies> = {},
): FastifyInstance {
  const app = Fastify(options);
  const dependencies: AppDependencies = {
    modelCaller: dependencyOverrides.modelCaller ?? configuredModelCaller,
    evidenceOutputDirectory: dependencyOverrides.evidenceOutputDirectory ?? path.resolve(process.cwd(), "artifacts", "investigations"),
    demoDatasetDirectory: dependencyOverrides.demoDatasetDirectory ?? fileURLToPath(new URL("../../../../datasets/demo", import.meta.url)),
  };

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    return payload;
  });

  app.get("/health", async (_request, reply) => {
    const agent = configuredAgentStatus();
    try {
      await pool.query("select 1");
      return { status: "ok", service: "settleguard-api", version: "0.1.0", agent };
    } catch {
      return reply.code(503).send({ status: "degraded", service: "settleguard-api", version: "0.1.0", agent });
    }
  });
  void app.register(multipart, {
    limits: {
      fields: 1,
      files: 5,
      fileSize: 5 * 1024 * 1024,
      parts: 6,
    },
  });
  void app.register(registerBatchRoutes, dependencies);
  void app.register(registerRunRoutes);
  void app.register(registerExceptionRoutes, dependencies);
  void app.register(registerReviewCaseRoutes);
  void app.register(registerAuditRoutes);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
    } satisfies ApiErrorBody);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const httpError: Error & { statusCode?: number; code?: string } = error instanceof Error
      ? error
      : new Error("Unknown server error");
    const statusCode = httpError.statusCode && httpError.statusCode >= 400 ? httpError.statusCode : 500;
    if (statusCode >= 500) request.log.error(error);
    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : httpError.code ?? "REQUEST_ERROR",
        message: statusCode >= 500 ? "Internal server error" : httpError.message,
      },
    } satisfies ApiErrorBody);
  });

  return app;
}
