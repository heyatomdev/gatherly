import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../bastion.types';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest().user,
);
