import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import pinoHttp, { HttpLogger } from 'pino-http';
import { logger } from '../config/logger';

export const requestLogger: HttpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
    const id = incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode >= 300) return 'info';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
