import { Controller, Post, Body, UseGuards, Get, Request, Response, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SkipJwtAuth } from './decorators/skip-jwt-auth.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: any, refreshToken: string) {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private extractDeviceInfo(req: any): string {
    return req.headers['x-device-info'] || 'admin-web';
  }

  @SkipJwtAuth()
  @Post('register')
  @ApiOperation({ summary: 'Registrar novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário registrado com sucesso' })
  async register(@Body() createUserDto: CreateUserDto) {
    const user = await this.authService.register(createUserDto);
    const { password, ...result } = user;
    return result;
  }

  @SkipJwtAuth()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'Autenticar usuário' })
  @ApiResponse({ status: 200, description: 'Usuário autenticado com sucesso' })
  async login(@Body() loginDto: LoginDto, @Request() req, @Response({ passthrough: true }) res) {
    const result = await this.authService.login(req.user, this.extractDeviceInfo(req));
    this.setRefreshCookie(res, result.refresh_token);
    return result;
  }

  @SkipJwtAuth()
  @Post('refresh')
  @ApiOperation({ summary: 'Renovar access token via refresh token' })
  @ApiResponse({ status: 200, description: 'Novo par de tokens emitido' })
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Request() req,
    @Response({ passthrough: true }) res,
  ) {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] || refreshTokenDto.refresh_token;
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token não fornecido');
    }

    const result = await this.authService.refresh(rawToken, this.extractDeviceInfo(req));
    this.setRefreshCookie(res, result.refresh_token);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revogar a sessão atual' })
  @ApiResponse({ status: 200, description: 'Sessão revogada' })
  async logout(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Request() req,
    @Response({ passthrough: true }) res,
  ) {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] || refreshTokenDto.refresh_token;
    if (rawToken) {
      await this.authService.logout(rawToken);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obter perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Perfil do usuário' })
  getProfile(@Request() req) {
    return req.user;
  }
}
