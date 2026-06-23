import { Controller, Get, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';

/**
 * Token broker interno (microserviços) — protegido por x-internal-key.
 * Contrato desacoplado: o consumidor manda CONTEXTO DE NEGÓCIO (tag do
 * marketplace + domain opcional); o backend resolve a conta internamente. O
 * vocabulário "account" não vaza para o contrato.
 */
@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalTokenController {
    constructor(
        private readonly authService: MarketplaceAuthService,
        private readonly registry: MarketplaceRegistryService,
    ) {}

    /**
     * Access token válido (já renovado) para um marketplace, opcionalmente para
     * o domínio informado (multi-client).
     *
     * Usage: GET /internal/token/mercadolivre
     *        GET /internal/token/mercadolivre?domain=general
     */
    @Get('token/:tag')
    async getToken(@Param('tag') tag: string, @Query('domain') domain?: string) {
        const marketplace = await this.registry.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

        // Publicação desligada (sem conta ativa selecionada): não é erro — skip.
        if (await this.authService.isPublishingDisabled(marketplace._id.toString())) {
            return { disabled: true };
        }

        const resolved = await this.authService.ensureValidToken(marketplace._id.toString(), domain);
        if (!resolved?.accessToken) throw new NotFoundException(`No active token for marketplace: ${tag}`);

        return { token: resolved };
    }

    /**
     * @deprecated Alias de retrocompatibilidade para o contrato antigo
     * (`/token/account/:tag/:domain`). Removido na fatia final da unificação —
     * use `GET /internal/token/:tag?domain=`. Mantido só para o orchestrator
     * em trânsito não quebrar durante a migração.
     */
    @Get('token/account/:tag/:domain')
    async getAccountToken(@Param('tag') tag: string, @Param('domain') domain: string) {
        const marketplace = await this.registry.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

        const resolved = await this.authService.ensureValidToken(marketplace._id.toString(), domain);
        if (!resolved?.accessToken) throw new NotFoundException(`No active token for ${tag}/${domain}`);

        return { token: resolved };
    }
}
