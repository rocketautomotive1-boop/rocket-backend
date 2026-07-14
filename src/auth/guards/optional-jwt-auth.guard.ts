import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Popula req.user quando há um Bearer token válido, mas NUNCA rejeita a
 * requisição — usado em rotas que servem tanto clientes logados quanto
 * convidados (carrinho/checkout via session_id).
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) { }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                request.user = this.jwtService.verify(token);
            } catch {
                // Token presente mas inválido/expirado — segue como convidado, não bloqueia.
            }
        }

        return true;
    }
}
