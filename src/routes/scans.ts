import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate, resolveBrand } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";
import { scanOrchestrateQueue } from "../queues";
import {
  isModelRunnable,
  loadKeyedProviders,
} from "../services/llm/llm-router";
import { ModelName, ScanTrigger } from "../types";

const router = Router();
router.use(authenticate, resolveBrand);

const triggerScanSchema = z.object({
  triggered_by: z.enum(["manual", "onboarding"]).default("manual"),
  prompt_ids: z.array(z.string().uuid()).optional().nullable(),
  model_ids: z.array(z.string()).optional().nullable(),
});

/**
 * POST /api/v1/scans
 * Trigger a new scan for the authenticated org.
 */
router.post("/", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { account_id } = req.user!;

  const body = triggerScanSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  // Require at least one enabled model backed by a validated provider key.
  const [{ data: account }, keyed] = await Promise.all([
    supabase
      .from("accounts")
      .select("enabled_models")
      .eq("id", account_id)
      .single(),
    loadKeyedProviders(account_id),
  ]);
  const runnable = ((account?.enabled_models as ModelName[]) ?? []).some((m) =>
    isModelRunnable(m, keyed),
  );
  if (!runnable) {
    throw new ApiError(
      400,
      "NO_PROVIDER_KEY",
      "Connect at least one AI provider key and enable its model before scanning.",
    );
  }

  // Check for an already-running scan
  const { data: running } = await supabase
    .from("scans")
    .select("id")
    .eq("brand_id", brand_id)
    .eq("status", "running")
    .single();

  if (running) {
    throw new ApiError(
      409,
      "SCAN_RUNNING",
      "A scan is already in progress for this brand",
    );
  }

  // Create the scan record
  const { data: scan, error } = await supabase
    .from("scans")
    .insert({
      brand_id,
      triggered_by: body.data.triggered_by as ScanTrigger,
      status: "pending",
    })
    .select()
    .single();

  if (error || !scan)
    throw new ApiError(500, "DB_ERROR", "Failed to create scan");

  // Enqueue the orchestration job
  await scanOrchestrateQueue.add("orchestrate", {
    brand_id,
    account_id,
    scan_id: scan.id,
    triggered_by: body.data.triggered_by,
    prompt_ids: body.data.prompt_ids ?? undefined,
    model_ids: (body.data.model_ids as ModelName[] | undefined) ?? undefined,
  });

  req.log.info(
    {
      event: "scans.triggered",
      scan_id: scan.id,
      triggered_by: body.data.triggered_by,
      prompt_count: body.data.prompt_ids?.length,
      model_count: body.data.model_ids?.length,
    },
    "scan triggered",
  );

  res.status(201).json({
    data: {
      scan_id: scan.id,
      status: scan.status,
      total_tasks: 0,
    },
  });
});

/**
 * GET /api/v1/scans/:id
 * Return scan status and progress.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const brand_id = req.brand_id!;
  const { id } = req.params;

  const { data: scan, error } = await supabase
    .from("scans")
    .select("*")
    .eq("id", id)
    .eq("brand_id", brand_id)
    .single();

  if (error || !scan) throw new ApiError(404, "NOT_FOUND", "Scan not found");

  const progress =
    scan.total_tasks > 0
      ? Math.round((scan.completed_tasks / scan.total_tasks) * 100)
      : 0;

  res.json({
    data: {
      id: scan.id,
      status: scan.status,
      triggered_by: scan.triggered_by,
      total_tasks: scan.total_tasks,
      completed_tasks: scan.completed_tasks,
      progress,
      started_at: scan.started_at,
      completed_at: scan.completed_at,
    },
  });
});

export default router;
