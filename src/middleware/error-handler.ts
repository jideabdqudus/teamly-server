import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const log = req.log ?? logger;

  if (err instanceof ApiError) {
    const level = err.statusCode >= 500 ? 'error' : 'warn';
    log[level](
      { err, statusCode: err.statusCode, code: err.code },
      'request failed',
    );
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  log.error({ err }, 'unhandled error');

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
