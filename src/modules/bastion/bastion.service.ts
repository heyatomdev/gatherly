import { Injectable, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginResponse, TokenResponse } from './bastion.types';

@Injectable()
export class BastionService {
  private readonly logger = new Logger(BastionService.name);
  private cachedClientToken: string | null = null;
  private clientTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get base(): string {
    return this.config.get<string>('BASTION_URL')!;
  }
  private get appSlug(): string {
    return this.config.get<string>('BASTION_APP_SLUG')!;
  }
  private get tenantSlug(): string | undefined {
    return this.config.get<string>('BASTION_TENANT_SLUG');
  }

  private async call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new HttpException((err as any).message ?? 'Bastion error', res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  login(email: string, password: string): Promise<LoginResponse> {
    return this.call('POST', '/auth/login', {
      email,
      password,
      appSlug: this.appSlug,
      tenantSlug: this.tenantSlug,
    });
  }

  refresh(refreshToken: string): Promise<TokenResponse> {
    return this.call('POST', '/auth/refresh', {
      refreshToken,
      appSlug: this.appSlug,
      tenantSlug: this.tenantSlug,
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.call('POST', '/auth/logout', { refreshToken });
  }

  // ─── Service Client ────────────────────────────────────────────────────────

  async clientAuth(): Promise<{ accessToken: string }> {
    const now = Date.now();
    if (this.cachedClientToken && now < this.clientTokenExpiresAt) {
      return { accessToken: this.cachedClientToken };
    }
    const result = await this.call<{ accessToken: string }>('POST', '/auth/client', {
      apiKey: this.config.getOrThrow<string>('BASTION_CLIENT_API_KEY'),
      serviceSlug: this.appSlug,
      ...(this.tenantSlug && { tenantSlug: this.tenantSlug }),
    });
    this.cachedClientToken = result.accessToken;
    this.clientTokenExpiresAt = now + 55 * 60 * 1000;
    return result;
  }

  // ─── Audit Events ─────────────────────────────────────────────────────────

  writeAuditEvent(
    accessToken: string,
    data: { event: string; userId?: string; metadata?: Record<string, unknown> },
  ): Promise<{ id: string; createdAt: Date }> {
    return this.call('POST', '/events', data, accessToken);
  }
}
