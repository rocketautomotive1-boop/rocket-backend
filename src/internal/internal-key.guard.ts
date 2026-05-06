import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalKeyGuard implements CanActivate {
    constructor(private readonly config: ConfigService) {}

    canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest();
        const expected = this.config.get<string>('INTERNAL_API_KEY');
        if (!expected) return true; // key not configured → open (dev only)
        if (req.headers['x-internal-key'] !== expected) throw new UnauthorizedException('Invalid internal key');
        return true;
    }
}
