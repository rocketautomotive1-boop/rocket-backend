import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ProductModule } from '../product/product.module';
import { AiBatchController } from './ai-batch.controller';
import { AiBatchService } from './ai-batch.service';
import { AiClerkController } from './ai-clerk.controller';
import { AiService } from './ai.service';
import { ProductDraftModel, ProductDraftSchema } from '../product/schemas/product-draft.schema';
import { ProductDraftsController } from './product-drafts.controller';
import { ProductDraftsService } from './product-drafts.service';
import { S3Module } from '../common/s3/s3.module';
import { ProcessedImageModule } from '../processed-image/processed-image.module';
import { AiImageController } from './ai-image.controller';
import { AiImageService } from './ai-image.service';
import { OpenAiImageClient } from './openai-image.client';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => ProductModule),
    S3Module,
    ProcessedImageModule,
    MongooseModule.forFeature([
      { name: ProductDraftModel.name, schema: ProductDraftSchema },
      { name: 'UserModel', schema: require('../auth/schemas/user.schema').UserSchema },
      { name: 'VehicleModel', schema: require('../customer/schemas/vehicle.schema').VehicleSchema },
    ])
  ],
  controllers: [AiBatchController, ProductDraftsController, AiClerkController, AiImageController],
  providers: [AiBatchService, ProductDraftsService, AiService, OpenAiImageClient, AiImageService],
  exports: [AiService, ProductDraftsService, AiBatchService]
})
export class AiModule { }