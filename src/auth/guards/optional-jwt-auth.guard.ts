import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';

/**
 * Popula req.user quando há um Bearer token válido, mas NUNCA rejeita a
 * requisição — usado em rotas que servem tanto clientes logados quanto
 * convidados (carrinho/checkout via session_id).
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private authService: AuthService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const payload = this.jwtService.verify(token);
                // storeId nunca é assinado no payload — resolvido fresco do banco, mesmo
                // motivo de JwtAuthGuard.
                const user = await this.authService.findById(payload.sub);
                request.user = { ...payload, storeId: user?.storeId ?? null };
            } catch {
                // Token presente mas inválido/expirado — segue como convidado, não bloqueia.
            }
        }

        return true;
    }
}
