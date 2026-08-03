import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { ProjectDataModule } from './project-data/project-data.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri = config.get<string>('MONGODB_URI');
        if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');
        return { uri, maxPoolSize: 20, serverSelectionTimeoutMS: 10000 };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'dist', 'client'),
      exclude: ['/api/{*path}'],
    }),
    ProjectDataModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
