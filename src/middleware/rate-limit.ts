import { Request, Response, NextFunction } from 'express';

// Simple in-memory rate limiter per org_id
// For production: use Redis-backed rate limiting (e.g., rate-limiter-flexible)
const requestCounts = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100; // per org per minute

export function rateLimitByOrg(req: Request, res: Response, next: NextFunction): void {
  const orgId = req.user?.org_id;
  if (!orgId) {
    next();
    return;
  }

  const now = Date.now();
  const entry = requestCounts.get(orgId);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(orgId, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= MAX_REQUESTS) {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
    });
    return;
  }

  entry.count++;
  next();
}
