import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService
  ) { }

  @UseGuards(JwtAuthGuard)
  @Post('register')
  async register(@Body() body: { token: string }, @Req() req: any) {
    // JWT strategy returns the payload directly, so userId is in 'sub'
    const userId = req.user?.sub || req.user?.id;
    const result = await this.notificationsService.registerToken(String(userId), body.token);

    return { ok: result };
  }

  @Post('push')
  async push(@Body() body: { token: string; title: string; body: string; actionRoute?: string }) {
    await this.notificationsService.sendPush(body.token, body.title, body.body, { actionRoute: body.actionRoute || '/(drawer)/notifications' });
    return { ok: true };
  }
}