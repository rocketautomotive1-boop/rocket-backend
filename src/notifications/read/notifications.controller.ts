import { Controller, Get, Patch, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { NotificationReadService } from './notification-read.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly read: NotificationReadService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('category') category?: string, @Req() req?: any,
  ) {
    const userId = req.user?.sub || req.user?.id;
    return this.read.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      category, userId: String(userId),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    return { count: await this.read.getUnreadCount(String(userId)) };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    await this.read.markAsRead(id, String(req.user?.sub || req.user?.id));
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  async markAllAsRead(@Req() req: any) {
    await this.read.markAllAsRead(String(req.user?.sub || req.user?.id));
    return { ok: true };
  }
}
