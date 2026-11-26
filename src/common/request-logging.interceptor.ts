import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';

type RequestWithUser = Request & {
  user?: {
    role?: string;
  };
};

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = this.getRequestId(request);
    const startedAt = Date.now();
    const method = request.method;
    const path = request.path;
    const role = request.user?.role ?? 'anonymous';

    response.setHeader('x-request-id', requestId);
    this.write('request.started', {
      requestId,
      method,
      path,
      role,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          this.write('request.completed', {
            requestId,
            method,
            path,
            role,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          });
        },
        error: (error: unknown) => {
          this.write('request.failed', {
            requestId,
            method,
            path,
            role,
            statusCode: this.getErrorStatus(error, response),
            durationMs: Date.now() - startedAt,
            errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
          }, 'error');
        },
      }),
    );
  }

  private getRequestId(request: Request) {
    const incomingRequestId = request.headers['x-request-id'];

    if (
      typeof incomingRequestId === 'string' &&
      incomingRequestId.length <= 100 &&
      /^[a-zA-Z0-9._:-]+$/.test(incomingRequestId)
    ) {
      return incomingRequestId;
    }

    return randomUUID();
  }

  private getErrorStatus(error: unknown, response: Response) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
    ) {
      return error.status;
    }

    return response.statusCode >= 400 ? response.statusCode : 500;
  }

  private write(
    event: string,
    metadata: Record<string, unknown>,
    level: 'log' | 'error' = 'log',
  ) {
    const message = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...metadata,
    });

    this.logger[level](message);
  }
}
