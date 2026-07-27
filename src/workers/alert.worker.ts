import { Worker, Job } from "bullmq";
import { redis } from "../config/redis";
import { childLogger } from "../config/logger";
import { AlertJob } from "../types";

const log = childLogger({ worker: "alert" });

export function createAlertWorker(): Worker {
  return new Worker<AlertJob>(
    "alert",
    async (job: Job<AlertJob>) => {
      const { scan_id, brand_id } = job.data;
      log.info(
        { job_id: job.id, scan_id, brand_id },
        "alert evaluation stub (deferred)",
      );
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );
}
