import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";
import { env } from "../config/env";

/**
 * Middleware to verify the X-API-Key header and the Supabase JWT.
 * Attaches req.user = { user_id, org_id, plan_tier } on success.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // 1. Verify API key
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== env.PULSEO_BACKEND_API_KEY) {
    res
      .status(401)
      .json({
        error: {
          code: "INVALID_API_KEY",
          message: "Invalid or missing API key",
        },
      });
    return;
  }

  // 2. Verify JWT
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res
      .status(401)
      .json({
        error: {
          code: "MISSING_TOKEN",
          message: "Authorization header required",
        },
      });
    return;
  }

  const token = authHeader.slice(7);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    res
      .status(401)
      .json({
        error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
      });
    return;
  }

  // 3. Load org for this user
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, plan_tier")
    .eq("user_id", user.id)
    .single();

  if (orgError || !org) {
    res
      .status(403)
      .json({
        error: {
          code: "NO_ORG",
          message: "No organization found for this user",
        },
      });
    return;
  }

  req.user = {
    user_id: user.id,
    org_id: org.id,
    plan_tier: org.plan_tier,
  };

  if (req.log) {
    req.log = req.log.child({ user_id: user.id, org_id: org.id });
  }

  next();
}
