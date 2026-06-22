import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuestionModel, QuestionSchema } from './schemas/question.schema';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModule } from '../product/product.module';
import { AuthModule } from '../auth/auth.module';
import { forwardRef } from '@nestjs/common';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { QuestionRepository } from './question.repository';
import { AiModule } from '../ai/ai.module';
import { QuestionIngestService } from './ingest/question-ingest.service';
import { QuestionReconciler } from './reconcile/question-reconciler.service';
import {
    QuestionReconcileCheckpointModel,
    QuestionReconcileCheckpointSchema,
} from './reconcile/question-reconcile-checkpoint.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: QuestionModel.name, schema: QuestionSchema },
            { name: QuestionReconcileCheckpointModel.name, schema: QuestionReconcileCheckpointSchema },
        ]),
        MarketplaceModule,
        forwardRef(() => ProductModule),
        MarketplaceRegistryModule,
        MarketplaceAuthModule,
        forwardRef(() => AuthModule),
        AiModule,
    ],
    controllers: [QuestionsController],
    providers: [
        QuestionsService,
        QuestionRepository,
        QuestionIngestService,
        QuestionReconciler,
    ],
    exports: [QuestionsService, QuestionRepository, QuestionIngestService],
})
export class QuestionsModule { }
