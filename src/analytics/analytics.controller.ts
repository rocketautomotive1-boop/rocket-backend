
import { Controller, Post, Get, Body, Delete, Query, Request, Ip, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';
import * as requestIp from 'request-ip';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @SkipJwtAuth()
    @Post('event')
    async trackEvent(
        @Body() body: any,
        @Request() req,
        @Query('session_id') sessionId: string,
        @Ip() ip: string
    ) {
        const clientIp = requestIp.getClientIp(req) || ip;
        const userId = req.user?.id || body.userId; // Trust body if not auth for guest tracking

        // Fire and forget (don't await to block response?) -> typically yes, but for now await to catch errors
        await this.analyticsService.trackEvent({
            userId,
            sessionId: sessionId || 'unknown',
            eventType: body.eventType,
            payload: body.payload,
            ip: clientIp,
            userAgent: req.headers['user-agent'],
            url: body.url
        });

        return { success: true };
    }

    @Get('history')
    async getHistory(
        @Request() req,
        @Query('session_id') sessionId: string
    ) {
        const userId = req.user?.id;
        return this.analyticsService.getRecentSearches(userId, sessionId);
    }

    @Delete('history')
    async clearHistory(
        @Request() req,
        @Query('session_id') sessionId: string,
        @Query('term') term?: string
    ) {
        console.log('Clearing history', { sessionId, term });

        const userId = req.user?.id;
        await this.analyticsService.clearSearchHistory(userId, sessionId, term);
        return { success: true };
    }
}
