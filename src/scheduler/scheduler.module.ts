import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { QueueModule } from '../queue/queue.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { MarketplaceOrchestratorModule } from '../marketplace-orchestrator/marketplace-orchestrator.module';
import { OrderModule } from '../order/order.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        QueueModule,
        MarketplaceModule,
        MarketplaceAuthModule,
        forwardRef(() => QuestionsModule),
        MarketplaceOrchestratorModule,
        forwardRef(() => OrderModule),
    ],
    providers: [SchedulerService],
})
export class SchedulerModule { }
