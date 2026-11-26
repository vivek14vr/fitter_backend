import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');
  const trustedProxy = process.env.TRUST_PROXY?.trim();
  if (trustedProxy === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  } else if (trustedProxy && /^\d+$/.test(trustedProxy)) {
    app.getHttpAdapter().getInstance().set('trust proxy', Number(trustedProxy));
  }
  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Lead-Continuation-Token',
      'X-Request-Id',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  const port = process.env.PORT ?? 3101;
  await app.listen(port);
  logger.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'server.started',
      port,
      environment: process.env.NODE_ENV ?? 'development',
    }),
  );
}

try {
  await bootstrap();
} catch (error) {
  const logger = new Logger('Bootstrap');
  logger.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'server.start_failed',
    errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
  }));
  process.exitCode = 1;
}
