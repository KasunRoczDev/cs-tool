import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

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
