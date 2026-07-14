import { Controller, Get, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
@SkipThrottle()
export class InternalTokenController {
    constructor(
        private readonly authService: MarketplaceAuthService,
        private readonly registry: MarketplaceRegistryService,
    ) {}

    /**
     * Access token válido (já renovado) para um marketplace.
     *
     * Dois modos de resolução (multi-client):
     *  - `accountId` → SAÍDA por DONO (UPDATE/DELETE/operacional): a conta é a que
     *    criou o anúncio, carimbada no listing. Rota direta à conta — NÃO passa
     *    pelo gate de "publicação desligada" (a conta ativa da tela é irrelevante
     *    aqui; estamos atualizando um anúncio que já existe sob esta conta).
     *  - senão → SAÍDA por SELEÇÃO (CREATE): usa a conta ATIVA da tela; se nenhuma
     *    ativa, `{ disabled: true }` (skip, não é erro). `domain` é aceito por
     *    compat mas não roteia mais a seleção.
     *
     * Usage: GET /internal/token/mercadolivre
     *        GET /internal/token/mercadolivre?accountId=<id>   (dono do listing)
     */
    @Get('token/:tag')
    async getToken(
        @Param('tag') tag: string,
        @Query('domain') domain?: string,
        @Query('accountId') accountId?: string,
    ) {
        const marketplace = await this.registry.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

        if (accountId) {
            const resolved = await this.authService.ensureValidToken(marketplace._id.toString(), { accountId });
            if (!resolved?.accessToken) throw new NotFoundException(`No active token for ${tag} account ${accountId}`);
            return { token: resolved };
        }

        // Publicação desligada (sem conta ativa selecionada): não é erro — skip.
        if (await this.authService.isPublishingDisabled(marketplace._id.toString())) {
            return { disabled: true };
        }

        const resolved = await this.authService.ensureValidToken(marketplace._id.toString(), { domain });
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
