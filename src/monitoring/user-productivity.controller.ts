import { Controller, Get, Req, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserProductivityService } from './user-productivity.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Productivity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('productivity')
export class UserProductivityController {
    constructor(private readonly userProductivityService: UserProductivityService) { }

    @Get('my-stats')
    @ApiOperation({ summary: 'Get current user productivity stats for a given period' })
    async getMyStats(@Req() req: any, @Query('period') period?: string) {
        const user = req.user;
        const userId = user?.userId || user?.id || user?.sub;

        if (!userId) {
            throw new UnauthorizedException('User identifier missing from token');
        }

        return this.userProductivityService.getStats(userId, period);
    }

    @Get('my-weekly-stats')
    @ApiOperation({ summary: 'Get current user productivity stats aggregated by the last 7 days' })
    async getMyWeeklyStats(@Req() req: any) {
        const user = req.user;
        const userId = user?.userId || user?.id || user?.sub;

        if (!userId) {
            throw new UnauthorizedException('User identifier missing from token');
        }

        return this.userProductivityService.getWeeklyStats(userId);
    }
}
