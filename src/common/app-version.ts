import { join } from 'node:path';
import { readAppVersion } from '@heyatom/nest-common';

/** package.json `version`: `../..` is the repo root from both `src/common/` and `dist/common/`. */
export const APP_VERSION = readAppVersion(join(__dirname, '../..'));
