import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { initImportWorker } from './queues/import.queue';
import { ImportService } from './contacts/import.service';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

const logger = new Logger('Bootstrap');

function buildCorsOrigins(): (RegExp | string)[] {
  const origins: (RegExp | string)[] = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  ];
  const prod = process.env.FRONTEND_URL?.trim();
  if (prod) origins.push(prod);
  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // Sécurité HTTP : X-Frame-Options, CSP, HSTS, XSS-Filter…
  app.use(
    helmet({
      contentSecurityPolicy: false, // Swagger UI nécessite inline scripts
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS doit être activé AVANT bodyParser pour que les headers
  // soient présents même sur les réponses d'erreur (413, 401, etc.)
  app.enableCors({
    origin: buildCorsOrigins(),
    credentials: true,
  });

  // Capture raw body + limite portée à 10 Mo pour les imports CSV en chunks
  app.use(
    bodyParser.json({
      limit: '10mb',
      verify: (req, _res, buf: Buffer) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('NovaSMS API')
    .setDescription('API documentation for NovaSMS platform')
    .setVersion('1.0')
    .addTag('Authentification')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // 🔧 Initialize import worker after app creation
  try {
    const importService = app.get(ImportService);
    if (importService) {
      initImportWorker(importService);
      logger.log('Import worker initialized');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not initialize import worker: ${msg}`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Backend running on http://localhost:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
void bootstrap();
