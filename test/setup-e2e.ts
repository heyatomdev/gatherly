// Runs before any test module is imported (jest `setupFiles`), so env is present
// when AppModule's ConfigModule.forRoot validates it. JWKS + Prisma are mocked in
// the specs, so these values only need to satisfy config validation.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/gatherly_test';
process.env.BASTION_URL ??= 'http://localhost:3001';
process.env.BASTION_APP_SLUG ??= 'gatherly';
process.env.BASTION_CLIENT_API_KEY ??= 'sc_test';
process.env.ADMIN_ACCEPTED_APP_SLUGS ??= 'gatherly,meridian';
