import { ConfigService } from '@nestjs/config';
import { LoggerParams, loggerParams } from '@heyatom/nest-common';

/**
 * nestjs-pino params, platform defaults from `@heyatom/nest-common`: server-generated
 * request id set as `X-Request-Id`, caller's id logged only as `clientRequestId`,
 * `/health*` not logged, request lines with `req.{id,method,url,remoteAddress}` and the
 * status only — never headers or bodies.
 */
export function loggerConfig(config: ConfigService): LoggerParams {
  return loggerParams({
    service: 'gatherly',
    level: config.getOrThrow<string>('LOG_LEVEL'),
    pretty: config.get<string>('NODE_ENV') !== 'production',
  });
}
