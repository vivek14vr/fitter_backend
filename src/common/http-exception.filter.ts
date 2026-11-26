import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type ErrorResponse = {
  message?: string | string[];
  error?: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = response.getHeader('x-request-id')?.toString() ?? null;
    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;

    let message: string | string[] = 'Unexpected server error';
    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
      const candidate = (exceptionResponse as ErrorResponse).message;
      if (typeof candidate === 'string' || Array.isArray(candidate)) {
        message = candidate;
      }
    }

    if (status >= 500) {
      this.logger.error(JSON.stringify({
        event: 'http.exception.unhandled',
        requestId,
        method: request.method,
        path: request.path,
        errorType: exception instanceof Error ? exception.constructor.name : 'UnknownError',
      }));
      message = 'Unexpected server error';
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}
