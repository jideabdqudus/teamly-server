import { Router, Request, Response } from "express";
import { z } from "zod";
import { createSessionClient, supabase } from "../config/supabase";
import { ApiError } from "../middleware/error-handler";

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  full_name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/v1/auth/signup
 * Create a new user + organization
 */
router.post("/signup", async (req: Request, res: Response) => {
  const body = signupSchema.safeParse(req.body);

  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const { email, password, full_name } = body.data;

  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

  if (authError || !authData.user) {
    if (authError?.message?.toLowerCase().includes("already")) {
      throw new ApiError(
        409,
        "USER_EXISTS",
        "An account with this email already exists",
      );
    }
    throw new ApiError(
      400,
      "AUTH_ERROR",
      authError?.message ?? "Failed to create user",
    );
  }

  const userId = authData.user.id;

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("user_id", userId)
    .single();

  if (accountError || !account) {
    req.log.error(
      {
        event: "auth.signup.account_missing",
        user_id: userId,
        supabase: accountError
          ? {
              message: accountError.message,
              code: accountError.code,
              details: accountError.details,
              hint: accountError.hint,
            }
          : null,
      },
      "account not found after signup (handle_new_user trigger missing?)",
    );
    await supabase.auth.admin.deleteUser(userId);
    throw new ApiError(
      500,
      "ACCOUNT_CREATE_FAILED",
      "Failed to create account",
    );
  }

  const { data: sessionData, error: sessionError } =
    await createSessionClient().auth.signInWithPassword({
      email,
      password,
    });

  if (sessionError || !sessionData.session) {
    throw new ApiError(
      500,
      "SESSION_ERROR",
      "Account created but failed to sign in",
    );
  }

  req.log.info(
    { event: "auth.signup", user_id: userId, account_id: account.id },
    "user signed up",
  );

  res.status(201).json({
    data: {
      user: {
        id: userId,
        email,
        full_name,
      },
      account: { id: account.id, name: account.name },
      brands: [],
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_at: sessionData.session.expires_at,
      },
    },
  });
});

/**
 * POST /api/v1/auth/login
 */
router.post("/login", async (req: Request, res: Response) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", body.error.errors[0].message);
  }

  const { email, password } = body.data;

  const { data, error } = await createSessionClient().auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session || !data.user) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  // Load profile + account + brands
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", data.user.id)
    .single();

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("user_id", data.user.id)
    .single();

  const { data: brands } = account
    ? await supabase
        .from("brands")
        .select("*")
        .eq("account_id", account.id)
        .order("created_at", { ascending: true })
    : { data: [] };

  req.log.info(
    { event: "auth.login", user_id: data.user.id, account_id: account?.id },
    "user logged in",
  );

  res.json({
    data: {
      user: {
        id: data.user.id,
        email: data.user.email,
        full_name: profile?.full_name ?? "",
        avatar_url: profile?.avatar_url,
      },
      account: account ?? null,
      brands: brands ?? [],
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    },
  });
});

/**
 * POST /api/v1/auth/logout
 */
router.post("/logout", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    await supabase.auth.admin.signOut(token);
  }
  req.log.info({ event: "auth.logout" }, "user logged out");
  res.json({ data: { message: "Logged out successfully" } });
});

/**
 * POST /api/v1/auth/forgot-password
 */
router.post("/forgot-password", async (req: Request, res: Response) => {
  const body = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Valid email is required");
  }

  await supabase.auth.resetPasswordForEmail(body.data.email);

  req.log.info(
    { event: "auth.password_reset_requested" },
    "password reset requested",
  );

  // Always return success to prevent email enumeration
  res.json({
    data: { message: "If an account exists, a reset email has been sent" },
  });
});

/**
 * POST /api/v1/auth/refresh
 */
router.post("/refresh", async (req: Request, res: Response) => {
  const body = z
    .object({ refresh_token: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "refresh_token is required");
  }

  const { data, error } = await createSessionClient().auth.refreshSession({
    refresh_token: body.data.refresh_token,
  });

  if (error || !data.session) {
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Invalid or expired refresh token",
    );
  }

  req.log.info(
    { event: "auth.refresh", user_id: data.user?.id },
    "session refreshed",
  );

  res.json({
    data: {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    },
  });
});

export default router;
