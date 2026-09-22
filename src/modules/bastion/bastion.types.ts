export interface JwtPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email?: string;
  username?: string;
  image?: string | null;
  preferredLocale?: string;
  /** Present on user tokens. A service-client token carries `serviceSlug` instead. */
  appSlug?: string;
  role?: string;
  permissions?: string[];
  /** Only machine tokens set this, to `'service_client'`. User tokens omit it. */
  type?: string;
  /** The service a machine token was minted for. Absent on user tokens. */
  serviceSlug?: string;
  iat: number;
  exp: number;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface TwoFactorPendingResponse {
  twoFactorPending: true;
  twoFactorToken: string;
}

export type LoginResponse = TokenResponse | TwoFactorPendingResponse;
