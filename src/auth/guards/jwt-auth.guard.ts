import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SKIP_JWT_AUTH_KEY } from '../decorators/skip-jwt-auth.decorator';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private authService: AuthService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Guard global (APP_GUARD) roda em todo ExecutionContext, incluindo handlers
    // RPC (@RabbitSubscribe) — que não têm request HTTP nenhum. Autenticação de
    // fila é responsabilidade do broker/rede interna, não deste guard.
    if (context.getType() !== 'http') {
      return true;
    }

    // Verificar se a rota está marcada para pular autenticação JWT
    const skipAuth = this.reflector.getAllAndOverride<boolean>(
      SKIP_JWT_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipAuth) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token não fornecido ou formato inválido');
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = this.jwtService.verify(token);
      // storeId nunca é assinado no payload (ver AuthService.login) — precisa ser
      // resolvido fresco do banco a cada request, mesmo padrão que JwtStrategy.validate
      // já fazia (mas este guard não passa pelo Passport/JwtStrategy, faz jwtService.verify
      // diretamente — sem isto, request.user.storeId nunca existe e todo endpoint que exige
      // loja configurada rejeita mesmo usuários com storeId real no banco).
      const user = await this.authService.findById(payload.sub);
      request.user = { ...payload, storeId: user?.storeId ?? null };
      return true;
    } catch (error) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}
