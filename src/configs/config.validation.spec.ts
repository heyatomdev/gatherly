import { validate } from './config.validation';

describe('config validation — ENABLE_SWAGGER', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    BASTION_URL: 'http://bastion',
    BASTION_APP_SLUG: 'gatherly',
    BASTION_CLIENT_API_KEY: 'sc_x',
  };

  it.each([
    [undefined, 'false'],
    ['production', 'false'],
    ['development', 'true'],
    ['test', 'true'],
  ])(
    'defaults from an explicit NODE_ENV only (%s → %s)',
    (nodeEnv, expected) => {
      const env = nodeEnv ? { ...base, NODE_ENV: nodeEnv } : base;
      expect(validate(env).ENABLE_SWAGGER).toBe(expected);
    },
  );

  it('honours an explicit value', () => {
    expect(
      validate({ ...base, NODE_ENV: 'production', ENABLE_SWAGGER: 'true' })
        .ENABLE_SWAGGER,
    ).toBe('true');
    expect(
      validate({ ...base, NODE_ENV: 'development', ENABLE_SWAGGER: 'false' })
        .ENABLE_SWAGGER,
    ).toBe('false');
  });

  it('rejects anything but true/false', () => {
    expect(() => validate({ ...base, ENABLE_SWAGGER: 'yes' })).toThrow(
      /ENABLE_SWAGGER/,
    );
  });
});
