import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SKIP_JWT_AUTH_KEY } from '../decorators/skip-jwt-auth.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) { }

  canActivate(context: ExecutionContext): boolean {
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
      request.user = payload;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}
