
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEvent, AnalyticsEventSchema } from './schemas/event.schema';
import { SearchHistory, SearchHistorySchema } from './schemas/search-history.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
            { name: SearchHistory.name, schema: SearchHistorySchema },
        ]),
    ],
    controllers: [AnalyticsController],
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule { }
