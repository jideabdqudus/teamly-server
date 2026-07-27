import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../config/supabase";
import { authenticate } from "../middleware/auth";
import { ApiError } from "../middleware/error-handler";
import { encryptSecret, maskSecret } from "../lib/crypto";
import {
  isProviderId,
  validateProviderKey,
  getProviderForModel,
} from "../services/llm/llm-router";
import type { ModelName } from "../types";

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/provider-keys
 * Masked list of the account's configured provider keys. Never returns raw keys.
 */
router.get("/", async (req: Request, res: Response) => {
  const { account_id } = req.user!;

  const { data, error } = await supabase
    .from("provider_keys")
    .select("provider, masked, last_validated_at, updated_at")
    .eq("account_id", account_id);

  if (error)
    throw new ApiError(500, "DB_ERROR", "Failed to fetch provider keys");

  res.json({ data: data ?? [] });
});

const putKeySchema = z.object({ key: z.string().min(8) });

/**
 * PUT /api/v1/provider-keys/:provider
 * Validate the key with the provider, then store it encrypted (upsert).
 */
router.put("/:provider", async (req: Request, res: Response) => {
  const { account_id } = req.user!;
  const provider = String(req.params.provider);

  if (!isProviderId(provider)) {
    throw new ApiError(
      400,
      "UNKNOWN_PROVIDER",
      `Unknown provider: ${provider}`,
    );
  }

  const body = putKeySchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "A valid key is required");
  }

  const key = body.data.key.trim();

  // Validate against the provider before persisting. We deliberately don't log
  // the raw provider error — it can echo back fragments of the submitted key.
  try {
    await validateProviderKey(provider, key);
  } catch {
    req.log.info(
      { event: "provider_keys.invalid", provider },
      "provider key validation failed",
    );
    throw new ApiError(
      400,
      "INVALID_KEY",
      `That ${provider} key didn't validate. Check it and try again.`,
    );
  }

  const encrypted = encryptSecret(key);

  const { error } = await supabase.from("provider_keys").upsert(
    {
      account_id,
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      masked: maskSecret(key),
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id,provider" },
  );

  if (error) throw new ApiError(500, "DB_ERROR", "Failed to save provider key");

  req.log.info(
    { event: "provider_keys.saved", provider },
    "provider key saved",
  );

  res.json({ data: { provider, masked: maskSecret(key), valid: true } });
});

/**
 * DELETE /api/v1/provider-keys/:provider
 * Remove a key and disable any enabled models that depend on it.
 */
router.delete("/:provider", async (req: Request, res: Response) => {
  const { account_id } = req.user!;
  const provider = String(req.params.provider);

  if (!isProviderId(provider)) {
    throw new ApiError(
      400,
      "UNKNOWN_PROVIDER",
      `Unknown provider: ${provider}`,
    );
  }

  const { error } = await supabase
    .from("provider_keys")
    .delete()
    .eq("account_id", account_id)
    .eq("provider", provider);

  if (error)
    throw new ApiError(500, "DB_ERROR", "Failed to remove provider key");

  // Disable enabled models whose provider was just removed.
  const { data: account } = await supabase
    .from("accounts")
    .select("enabled_models")
    .eq("id", account_id)
    .single();

  if (account) {
    const pruned = (account.enabled_models as ModelName[]).filter(
      (m) => getProviderForModel(m) !== provider,
    );
    if (pruned.length !== account.enabled_models.length) {
      await supabase
        .from("accounts")
        .update({
          enabled_models: pruned,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account_id);
    }
  }

  req.log.info(
    { event: "provider_keys.deleted", provider },
    "provider key removed",
  );

  res.json({ data: { message: "Provider key removed" } });
});

export default router;
