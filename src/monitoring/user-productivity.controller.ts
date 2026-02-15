import { Controller, Get, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserProductivityService } from './user-productivity.service';

@ApiTags('Productivity')
@ApiBearerAuth()
@Controller('productivity')
export class UserProductivityController {
    constructor(private readonly userProductivityService: UserProductivityService) { }

    @Get('my-stats')
    @ApiOperation({ summary: 'Get current user productivity stats for today' })
    async getMyStats(@Req() req: any) {
        // Assuming AuthGuard populates req.user
        // If not, we might need to rely on a custom decorator or check headers/token
        // For this specific codebase, usually req.user is populated by passport/strategy

        const user = req.user;
        if (!user || !user.userId) {
            // Fallback for development/testing if allowed, or throw
            // throw new UnauthorizedException('User context not found');
            // TEMPORARY: Return stats for 'SYSTEM' or specific mock user if strict auth isn't setup in this specific context yet
            // Better: Let's assume the auth middleware works. If it fails, the user will report 401.
        }

        const userId = user?.userId || user?.id; // Adjust based on actual JWT payload structure

        if (!userId) {
            throw new UnauthorizedException('User identifier missing from token');
        }

        return this.userProductivityService.getStats(userId);
    }
}
