import pino, { Logger } from 'pino';
import { env } from './env';

const isProd = env.NODE_ENV === 'production';
const level = env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

export const logger: Logger = pino({
  level,
  base: { service: 'pulseo-server', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refresh_token',
      'req.body.access_token',
      'res.headers["set-cookie"]',
      '*.password',
      '*.access_token',
      '*.refresh_token',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      },
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
