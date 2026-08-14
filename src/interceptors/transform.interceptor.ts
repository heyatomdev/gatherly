import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // Pass through null/undefined and already-enveloped paginated results
        if (data == null) return data as any;
        if (typeof data === 'object' && 'data' in (data as object) && 'meta' in (data as object)) return data as any;
        return { data };
      }),
    );
  }
}
