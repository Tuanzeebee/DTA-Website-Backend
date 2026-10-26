import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.use(compression());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Static file serving for images
  const exportDir = config.get<string>('EXPORT_DIR', './craw-data/export');
  // Cache-Control để Cloudflare giữ ảnh ở edge thay vì mỗi lượt xem lại đi
  // qua tunnel về VPS. Ảnh upload đặt tên `${Date.now()}-${uuid}` → bất biến.
  app.useStaticAssets(join(exportDir, 'images'), {
    prefix: '/news-images',
    maxAge: '7d',
  });
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    maxAge: '30d',
    immutable: true,
  });

  app.enableCors();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  console.log(`DTA backend is running on http://${host}:${port}`);
}

void bootstrap();
