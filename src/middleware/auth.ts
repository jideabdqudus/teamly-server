import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { supabase } from "../config/supabase";
import { env } from "../config/env";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers["x-api-key"];
  if (
    typeof apiKey !== "string" ||
    !safeEqual(apiKey, env.TEAMLY_BACKEND_API_KEY)
  ) {
    res.status(401).json({
      error: { code: "INVALID_API_KEY", message: "Invalid or missing API key" },
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
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
    res.status(401).json({
      error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
    });
    return;
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    res.status(403).json({
      error: { code: "NO_ACCOUNT", message: "No account found for this user" },
    });
    return;
  }

  req.user = {
    user_id: user.id,
    account_id: account.id,
  };

  if (req.log) {
    req.log = req.log.child({ user_id: user.id, account_id: account.id });
  }

  next();
}

export async function resolveBrand(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { account_id } = req.user!;

  const headerValue = req.headers["x-brand-id"];
  const brandId =
    (typeof headerValue === "string" ? headerValue : undefined) ??
    (typeof req.query.brand_id === "string" ? req.query.brand_id : undefined);

  if (!brandId) {
    res.status(400).json({
      error: {
        code: "BRAND_REQUIRED",
        message: "X-Brand-Id header (or brand_id query) is required",
      },
    });
    return;
  }

  const { data: brand, error } = await supabase
    .from("brands")
    .select("id")
    .eq("id", brandId)
    .eq("account_id", account_id)
    .single();

  if (error || !brand) {
    res.status(404).json({
      error: {
        code: "BRAND_NOT_FOUND",
        message: "Brand not found for this account",
      },
    });
    return;
  }

  req.brand_id = brand.id;

  if (req.log) {
    req.log = req.log.child({ brand_id: brand.id });
  }

  next();
}
