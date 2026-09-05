import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Static file serving for images
  const exportDir = config.get<string>('EXPORT_DIR', './craw-data/export');
  app.useStaticAssets(join(exportDir, 'images'), { prefix: '/news-images' });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.enableCors();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`DTA backend is running on http://localhost:${port}`);
}

void bootstrap();
