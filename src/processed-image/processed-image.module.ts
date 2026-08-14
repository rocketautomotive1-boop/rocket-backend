import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProcessedImage, ProcessedImageSchema } from './schemas/processed-image.schema';
import { ProcessedImageService } from './processed-image.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProcessedImage.name, schema: ProcessedImageSchema },
    ]),
  ],
  providers: [ProcessedImageService],
  exports: [ProcessedImageService],
})
export class ProcessedImageModule {}
