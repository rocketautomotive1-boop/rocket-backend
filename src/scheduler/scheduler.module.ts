import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { QueueModule } from '../queue/queue.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        QueueModule,
        MarketplaceModule,
        MarketplaceAuthModule,
    ],
    providers: [SchedulerService],
})
export class SchedulerModule { }
