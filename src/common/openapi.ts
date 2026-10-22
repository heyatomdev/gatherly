import type { SwaggerOptions } from '@heyatom/nest-common';
import { APP_VERSION } from './app-version';

/** Shared by `setupSwagger` (main.ts) and `scripts/openapi-dump.ts`. */
export const SWAGGER_OPTIONS: SwaggerOptions = {
  title: 'Gatherly',
  version: APP_VERSION,
  configure: (b) => b.addBearerAuth(),
};
