import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuestionModel, QuestionSchema } from './schemas/question.schema';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductModule } from '../product/product.module';
import { AuthModule } from '../auth/auth.module';
import { forwardRef } from '@nestjs/common';
import { MarketplaceToken as MarketplaceTokenModel, MarketplaceTokenSchema } from '../marketplace/schemas/marketplace-token.schema';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { QuestionRepository } from './question.repository';
import { AiModule } from '../ai/ai.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: QuestionModel.name, schema: QuestionSchema },
            { name: MarketplaceTokenModel.name, schema: MarketplaceTokenSchema }
        ]),
        MarketplaceModule,
        NotificationsModule,
        forwardRef(() => ProductModule),
        MarketplaceRegistryModule,
        MarketplaceAuthModule,
        forwardRef(() => AuthModule),
        AiModule,
    ],
    controllers: [QuestionsController],
    providers: [QuestionsService, QuestionRepository],
    exports: [QuestionsService, QuestionRepository],
})
export class QuestionsModule { }
