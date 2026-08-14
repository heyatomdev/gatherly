export interface JwtPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email?: string;
  username?: string;
  image?: string | null;
  preferredLocale?: string;
  appSlug: string;
  role?: string;
  permissions?: string[];
  type?: string;
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
