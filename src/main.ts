import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { initImportWorker } from './queues/import.queue';
import { ImportService } from './contacts/import.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Préfixe global pour toutes les routes API
  app.setGlobalPrefix('api');
  // Capture raw body to allow strict webhook HMAC verification when needed
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
    credentials: true,
  });

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
      console.log('🔄 Import worker initialized');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ Could not initialize import worker:', msg);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log('🚀 Backend running on http://localhost:' + port);
  console.log('📖 Swagger docs: http://localhost:' + port + '/api/docs');
}
void bootstrap();
