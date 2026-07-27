import "express-async-errors"; // Must be imported before express — patches async error forwarding
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import brandsRoutes from "./routes/brands";
import providerKeysRoutes from "./routes/provider-keys";
import dashboardRoutes from "./routes/dashboard";
import scansRoutes from "./routes/scans";
import promptSuggestionsRoutes from "./routes/prompt-suggestions";
import promptsRoutes from "./routes/prompts";
import tagsRoutes from "./routes/tags";
import competitorsRoutes from "./routes/competitors";
import responsesRoutes from "./routes/responses";
import citationsRoutes from "./routes/citations";
import sentimentRoutes from "./routes/sentiment";
import alertsRoutes from "./routes/alerts";

// Workers
import { createScanOrchestratorWorker } from "./workers/scan-orchestrator.worker";
import { createLLMQueryWorker } from "./workers/llm-query.worker";
import { createAnalysisWorker } from "./workers/analysis.worker";
import { createScoringWorker } from "./workers/scoring.worker";
import { createAlertWorker } from "./workers/alert.worker";
import { registerDailyCron } from "./queues";

const app = express();
app.set("trust proxy", 1); // trust the first proxy so rate-limit sees real client IPs

const allowedOrigins = (env.FRONTEND_URL ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  if (env.NODE_ENV === "production") {
    logger.warn(
      "FRONTEND_URL is not set — cross-origin browser requests will be blocked",
    );
  } else {
    allowedOrigins.push("http://localhost:3000", "http://localhost:3006");
  }
}

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "RATE_LIMITED", message: "Too many requests, slow down." },
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many attempts, please try again later.",
    },
  },
});

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use(globalLimiter);

const openApiSpec = getOpenApiSpec();
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "Teamly API",
    swaggerOptions: { persistAuthorization: true },
  }),
);
app.get("/api/v1/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/me", meRoutes);
app.use("/api/v1/brands", brandsRoutes);
app.use("/api/v1/provider-keys", providerKeysRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/scans", scansRoutes);
app.use("/api/v1/prompts/suggestions", promptSuggestionsRoutes);
app.use("/api/v1/prompts", promptsRoutes);
app.use("/api/v1/tags", tagsRoutes);
app.use("/api/v1/competitors", competitorsRoutes);
app.use("/api/v1/responses", responsesRoutes);
app.use("/api/v1/citations", citationsRoutes);
app.use("/api/v1/sentiment", sentimentRoutes);
app.use("/api/v1/alerts", alertsRoutes);

app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.use(errorHandler);

function startWorkers(): void {
  createScanOrchestratorWorker();
  createLLMQueryWorker();
  createAnalysisWorker();
  createScoringWorker();
  createAlertWorker();
  logger.info("bullmq workers started");
}

app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "teamly server started");

  startWorkers();

  if (env.NODE_ENV === "production") {
    await registerDailyCron();
  }
});

export default app;
