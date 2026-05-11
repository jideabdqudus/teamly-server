import "express-async-errors"; // Must be imported before express — patches async error forwarding
import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { requestLogger } from "./middleware/request-logger";
import { errorHandler } from "./middleware/error-handler";
import { getOpenApiSpec } from "./lib/openapi";

// Routes
import authRoutes from "./routes/auth";
import healthRoutes from "./routes/health";
import meRoutes from "./routes/me";
import dashboardRoutes from "./routes/dashboard";
import scansRoutes from "./routes/scans";
import promptsRoutes from "./routes/prompts";
import competitorsRoutes from "./routes/competitors";
import responsesRoutes from "./routes/responses";
import citationsRoutes from "./routes/citations";
import alertsRoutes from "./routes/alerts";

// Workers
import { createScanOrchestratorWorker } from "./workers/scan-orchestrator.worker";
import { createLLMQueryWorker } from "./workers/llm-query.worker";
import { createAnalysisWorker } from "./workers/analysis.worker";
import { createScoringWorker } from "./workers/scoring.worker";
import { createAlertWorker } from "./workers/alert.worker";
import { registerDailyCron } from "./queues";

const app = express();

// ─── Security & Parsing Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "*",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);

const openApiSpec = getOpenApiSpec();
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "Pulseo API",
    swaggerOptions: { persistAuthorization: true },
  }),
);
app.get("/api/v1/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/me", meRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/scans", scansRoutes);
app.use("/api/v1/prompts", promptsRoutes);
app.use("/api/v1/competitors", competitorsRoutes);
app.use("/api/v1/responses", responsesRoutes);
app.use("/api/v1/citations", citationsRoutes);
app.use("/api/v1/alerts", alertsRoutes);

// 404 fallback
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

// Global error handler (must be last)
app.use(errorHandler);

// ─── Workers ──────────────────────────────────────────────────────────────────
function startWorkers(): void {
  createScanOrchestratorWorker();
  createLLMQueryWorker();
  createAnalysisWorker();
  createScoringWorker();
  createAlertWorker();
  logger.info("bullmq workers started");
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "pulseo server started");

  startWorkers();

  if (env.NODE_ENV === "production") {
    await registerDailyCron();
  }
});

export default app;
