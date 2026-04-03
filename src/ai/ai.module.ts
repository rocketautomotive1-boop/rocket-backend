import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SearchModule } from '../search/search.module';
import { ProductModule } from '../product/product.module';
import { AiBatchController } from './ai-batch.controller';
import { AiBatchService } from './ai-batch.service';
import { AiClerkController } from './ai-clerk.controller';
import { AiService } from './ai.service';
import { ProductDraftModel, ProductDraftSchema } from '../product/schemas/product-draft.schema';
import { ProductDraftsController } from './product-drafts.controller';
import { ProductDraftsService } from './product-drafts.service';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => SearchModule),
    forwardRef(() => ProductModule),
    MongooseModule.forFeature([
      { name: ProductDraftModel.name, schema: ProductDraftSchema },
      { name: 'UserModel', schema: require('../auth/schemas/user.schema').UserSchema },
      { name: 'VehicleModel', schema: require('../customer/schemas/vehicle.schema').VehicleSchema },
    ])
  ],
  controllers: [AiBatchController, ProductDraftsController, AiClerkController],
  providers: [AiBatchService, ProductDraftsService, AiService],
  exports: [AiService, ProductDraftsService, AiBatchService]
})
export class AiModule { }