import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    {
      provide: 'S3_CONFIG',
      useFactory: (configService: ConfigService) => {
        const s3Region =
          (configService.get<string>('AWS_S3_REGION') ||
            configService.get<string>('AWS_REGION') ||
            'us-east-1');
        return ({
          region: s3Region,
          credentials: {
            accessKeyId: configService.get('AWS_ACCESS_KEY_ID'),
            secretAccessKey: configService.get('AWS_SECRET_ACCESS_KEY'),
          },
          bucket: configService.get('AWS_S3_BUCKET'),
          endpoint: configService.get('AWS_S3_ENDPOINT'),
        });
      },
      inject: [ConfigService],
    },
    S3Service,
  ],
  exports: ['S3_CONFIG', S3Service],
})
export class S3Module {}