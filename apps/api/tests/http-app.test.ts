import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("HTTP application", () => {
  it("reports service health without opening a network port", async () => {
    app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok", service: "settleguard-api", version: "0.1.0" });
  });

  it("returns a stable JSON error for unknown routes", async () => {
    app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  it("does not expose internal error details", async () => {
    app = buildApp();
    app.get("/__test/error", async () => { throw new Error("database password leaked here"); });
    const response = await app.inject({ method: "GET", url: "/__test/error" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    expect(response.body).not.toContain("database password");
  });
});
