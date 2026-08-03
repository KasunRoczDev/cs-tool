import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    new Logger('Bootstrap').warn(
      'GITHUB_WEBHOOK_SECRET is not set — POST /api/v1/webhooks/github will accept ' +
        'unsigned requests from anyone. Set it (repo → Settings → Webhooks → Secret) before ' +
        'exposing this endpoint publicly.',
    );
  }

  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({
    limit: '100mb',
    // Stash the exact bytes received alongside the parsed body. Webhook signature
    // verification (webhooks.controller.ts) must HMAC these raw bytes — re-serializing
    // the parsed object with JSON.stringify is not guaranteed to reproduce what the
    // provider actually signed (key order, numeric precision, escaping can all differ).
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ 
    limit: '100mb',
    extended: true 
  }));
  app.enableCors({
    origin: process.env.DASHBOARD_ORIGIN?.split(',') ?? '*',
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend listening on :${port}`);
}
bootstrap();
