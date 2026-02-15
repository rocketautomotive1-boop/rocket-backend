
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as geoip from 'geoip-lite';
import { AnalyticsEvent, AnalyticsEventDocument } from './schemas/event.schema';
import { SearchHistory, SearchHistoryDocument } from './schemas/search-history.schema';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(
        @InjectModel(AnalyticsEvent.name) private eventModel: Model<AnalyticsEventDocument>,
        @InjectModel(SearchHistory.name) private searchHistoryModel: Model<SearchHistoryDocument>,
    ) { }

    async trackEvent(data: {
        userId?: string;
        sessionId: string;
        eventType: string;
        payload?: any;
        ip?: string;
        userAgent?: string;
        url?: string;
    }) {
        try {
            const geo = data.ip ? geoip.lookup(data.ip) : null;

            const event = new this.eventModel({
                userId: data.userId,
                sessionId: data.sessionId,
                eventType: data.eventType,
                payload: data.payload,
                metadata: {
                    ip: data.ip,
                    userAgent: data.userAgent,
                    url: data.url,
                    geo: geo ? {
                        country: geo.country,
                        region: geo.region,
                        city: geo.city,
                        ll: geo.ll
                    } : undefined
                }
            });

            await event.save();

            // Special handling for Search Events
            if (data.eventType === 'SEARCH' && data.payload?.term) {
                await this.updateSearchHistory(data.userId, data.sessionId, data.payload.term);
            }

        } catch (error) {
            this.logger.error(`Failed to track event: ${error.message}`);
            // Don't crash the request on analytics failure
        }
    }

    private async updateSearchHistory(userId: string | undefined, sessionId: string, term: string) {
        if (!term.trim()) return;

        const query = userId ? { userId, term } : { sessionId, term };

        // Find existing or create/update
        const existing = await this.searchHistoryModel.findOne(query);

        if (existing) {
            existing.count += 1;
            existing.lastSearchedAt = new Date();
            await existing.save();
        } else {
            // Limit history size per user? For now just add.
            await this.searchHistoryModel.create({
                userId,
                sessionId,
                term,
                count: 1,
                lastSearchedAt: new Date()
            });
        }
    }

    async getRecentSearches(userId: string | undefined, sessionId: string) {
        const query = userId ? { userId } : { sessionId };

        // Get top 10 most recent distinct terms
        return this.searchHistoryModel
            .find(query)
            .sort({ lastSearchedAt: -1 })
            .limit(10)
            .select('term lastSearchedAt')
            .exec();
    }

    async clearSearchHistory(userId: string | undefined, sessionId: string, term?: string): Promise<any> {
        const query: any = userId ? { userId } : { sessionId };
        if (term) query.term = term;

        return this.searchHistoryModel.deleteMany(query).exec();
    }
}
