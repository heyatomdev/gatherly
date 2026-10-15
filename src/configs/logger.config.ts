import { ConfigService } from '@nestjs/config';
import { loggerParams } from '@heyatom/nest-common';
import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';

/**
 * nestjs-pino params: the platform defaults from `@heyatom/nest-common`
 * (server-generated request id set as `X-Request-Id`, caller's id logged only
 * as `clientRequestId`, `/health*` not logged, header redaction), plus
 * gatherly's trimmed serializers — no headers or bodies in request logs at all.
 */
export function loggerConfig(config: ConfigService): Params {
  const params = loggerParams({
    service: 'gatherly',
    level: config.getOrThrow<string>('LOG_LEVEL'),
    pretty: config.get<string>('NODE_ENV') !== 'production',
  });
  return {
    ...params,
    pinoHttp: {
      ...(params.pinoHttp as Options),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
