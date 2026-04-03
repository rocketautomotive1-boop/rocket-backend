import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationBusService } from './notification-bus.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationBusService: NotificationBusService,
  ) { }

  @UseGuards(JwtAuthGuard)
  @Post('register')
  async register(@Body() body: { token: string }, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const result = await this.notificationsService.registerToken(String(userId), body.token);
    return { ok: result };
  }

  @Post('push')
  async push(@Body() body: { token: string; title: string; body: string; actionRoute?: string }) {
    await this.notificationsService.sendPush(body.token, body.title, body.body, { actionRoute: body.actionRoute || '/(drawer)/notifications' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Req() req?: any,
  ) {
    const userId = req.user?.sub || req.user?.id;
    return this.notificationBusService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      category,
      userId: String(userId),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const count = await this.notificationBusService.getUnreadCount(String(userId));
    return { count };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    await this.notificationBusService.markAsRead(id, String(userId));
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  async markAllAsRead(@Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    await this.notificationBusService.markAllAsRead(String(userId));
    return { ok: true };
  }
}