import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AdminThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (req.adminUser?.sub) return `user:${req.adminUser.sub}`;
    return `ip:${req.ip}`;
  }
}
