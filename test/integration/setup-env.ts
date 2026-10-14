// Runs in each test worker before any module import. DATABASE_URL comes from
// global-setup (the Testcontainers Postgres); the rest only has to pass config
// validation — JWKS is mocked in the specs, so Bastion is never called.
process.env.BASTION_URL ??= 'http://localhost:3001';
process.env.BASTION_APP_SLUG ??= 'gatherly';
process.env.BASTION_CLIENT_API_KEY ??= 'sc_test';
process.env.METRICS_PORT = '0';
process.env.THROTTLE_LIMIT = '100000';
process.env.LOG_LEVEL ??= 'error';
