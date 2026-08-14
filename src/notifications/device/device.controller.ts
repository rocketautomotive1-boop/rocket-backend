import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DeviceTokenService } from './device-token.service';

@Controller('notifications')
export class DeviceController {
  constructor(private readonly device: DeviceTokenService) {}

  @UseGuards(JwtAuthGuard)
  @Post('register')
  async register(@Body() body: { token: string }, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    return { ok: await this.device.registerToken(String(userId), body.token) };
  }
}
