import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function buildApp(options: FastifyServerOptions = { logger: false }): FastifyInstance {
  const app = Fastify(options);

  app.get("/health", async () => ({
    status: "ok",
    service: "settleguard-api",
    version: "0.1.0",
  }));

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
