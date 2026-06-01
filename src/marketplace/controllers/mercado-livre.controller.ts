import { Controller, Get, Post, Body, Param, Query, BadRequestException, BadGatewayException, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { MercadoLivreService } from '../services/mercado-livre.service';
import { MarketplaceService } from '../services/marketplace.service';
import { ProductTitleService } from '../../product/services/product-title.service';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { ProductService } from '../../product/product.service';
import { MercadoLivrePricingAdapter } from '../adapters/mercado-livre/mercado-livre-pricing.adapter';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'; // Assuming protection is needed

@ApiTags('Mercado Livre')
@Controller('marketplaces/mercadolivre')
export class MercadoLivreController {
    constructor(
        private readonly mercadoLivreService: MercadoLivreService,
        private readonly marketplaceService: MarketplaceService,
        private readonly productTitleService: ProductTitleService,
        private readonly marketplaceAuthService: MarketplaceAuthService,
        private readonly productService: ProductService,
        private readonly pricingAdapter: MercadoLivrePricingAdapter,
    ) { }

    @Get('item/:externalId/status')
    @ApiOperation({ summary: 'Consultar status de um item no Mercado Livre' })
    @ApiResponse({ status: 200, description: 'Status do item consultado com sucesso' })
    @ApiResponse({ status: 400, description: 'Parâmetros inválidos' })
    @ApiResponse({ status: 404, description: 'Item não encontrado' })
    @ApiParam({ name: 'externalId', description: 'ID externo do item no Mercado Livre' })
    async getItemStatus(
        @Param('externalId') externalId: string,
    ) {
        const marketplace = await this.marketplaceService.findByName('Mercado Livre');
        if (!marketplace) throw new BadRequestException('Marketplace Mercado Livre não encontrado');

        const productTitleDto = await this.productTitleService.findByExternalId(externalId);
        if (!productTitleDto || String(productTitleDto.marketplaceId) !== String(marketplace._id)) {
            throw new NotFoundException(`Item com ID externo ${externalId} não encontrado no Mercado Livre`);
        }

        return this.mercadoLivreService.getItemStatus(productTitleDto, marketplace);
    }

    @Get('item/:externalId/test-update')
    @ApiOperation({ summary: 'Testar atualização de um item no Mercado Livre' })
    @ApiResponse({ status: 200, description: 'Teste de atualização realizado com sucesso' })
    @ApiParam({ name: 'externalId', description: 'ID externo do item no Mercado Livre' })
    async testItemUpdate(
        @Param('externalId') externalId: string,
    ) {
        const marketplace = await this.marketplaceService.findByName('Mercado Livre');
        if (!marketplace) throw new BadRequestException('Marketplace Mercado Livre não encontrado');

        const productTitleDto = await this.productTitleService.findByExternalId(externalId);
        if (!productTitleDto || String(productTitleDto.marketplaceId) !== String(marketplace._id)) {
            throw new NotFoundException(`Item com ID externo ${externalId} não encontrado no Mercado Livre`);
        }

        try {
            const testData = {
                price: 100.00,
                available_quantity: 5,
                accessToken: (await this.marketplaceAuthService.ensureValidToken(marketplace._id)).accessToken
            };

            const result = await this.mercadoLivreService.testItemUpdate(externalId, testData);

            return {
                success: true,
                result,
                message: 'Teste de atualização realizado com sucesso'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: error.response?.data || null,
                message: 'Erro no teste de atualização'
            };
        }
    }

    @Get('item/:externalId/debug-data')
    @ApiOperation({ summary: 'Debug dos dados de atualização de um item no Mercado Livre' })
    @ApiResponse({ status: 200, description: 'Debug realizado com sucesso' })
    @ApiParam({ name: 'externalId', description: 'ID externo do item no Mercado Livre' })
    async debugItemData(
        @Param('externalId') externalId: string,
    ) {
        const marketplace = await this.marketplaceService.findByName('Mercado Livre');
        if (!marketplace) throw new BadRequestException('Marketplace Mercado Livre não encontrado');

        const productTitleDto = await this.productTitleService.findByExternalId(externalId);
        if (!productTitleDto || String(productTitleDto.marketplaceId) !== String(marketplace._id)) {
            throw new NotFoundException(`Item com ID externo ${externalId} não encontrado no Mercado Livre`);
        }

        try {
            const token = await this.marketplaceAuthService.ensureValidToken(marketplace._id);
            const itemData = await this.mercadoLivreService.getItem(externalId, token.accessToken);
            const { canUpdate, restrictions } = await this.mercadoLivreService.canUpdateItem(itemData);

            const testData = {
                title: 'Teste de Atualização',
                price: 150.00,
                available_quantity: 10,
                accessToken: token.accessToken
            };

            const filteredData = await this.mercadoLivreService.filterUpdatableFields(testData, restrictions);

            return {
                externalId,
                itemStatus: {
                    status: itemData.status,
                    canUpdate,
                    restrictions,
                    hasBids: itemData.initial_quantity !== itemData.available_quantity,
                    soldQuantity: itemData.sold_quantity
                },
                testData,
                filteredData,
                fieldsRemoved: Object.keys(testData).filter(key => !Object.keys(filteredData).includes(key)),
                fieldsKept: Object.keys(filteredData)
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: error.response?.data || null
            };
        }
    }

    @Post('discover-category')
    @ApiOperation({ summary: 'Descobrir categoria no Mercado Livre' })
    async discoverCategory(
        @Body('title') title: string,
        @Body('productId') productId: number,
    ) {
        const product = await this.productService.findDocument(String(productId));
        if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

        // Using ML service directly because this logic seems very specific (passing product doc)
        // Could eventually be genericized but for now extract is safer.
        return this.mercadoLivreService.discoverCategory(title, product);
    }

    @Get('listing-prices')
    @ApiOperation({ summary: 'Simula custos de venda no Mercado Livre (somente leitura). Com targetMargin pode levar alguns segundos (múltiplas consultas à ML).' })
    @ApiResponse({ status: 200, description: 'Comissão, lucro líquido e comparação de listing types' })
    @ApiResponse({ status: 400, description: 'Parâmetros inválidos' })
    async getListingPrices(
        @Query('price') priceRaw: string,
        @Query('cost') costRaw?: string,
        @Query('categoryId') categoryId?: string,
        @Query('listingTypeId') listingTypeId?: string,
        @Query('targetMargin') targetMarginRaw?: string,
    ) {
        const price = Number(priceRaw);
        if (!Number.isFinite(price) || price <= 0) {
            throw new BadRequestException('Parâmetro "price" deve ser um número maior que zero.');
        }
        const cost = costRaw !== undefined ? Number(costRaw) : undefined;
        if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) {
            throw new BadRequestException('Parâmetro "cost" deve ser um número maior ou igual a zero.');
        }
        const targetMargin = targetMarginRaw !== undefined ? Number(targetMarginRaw) : undefined;
        if (targetMargin !== undefined && (!Number.isFinite(targetMargin) || targetMargin <= 0 || targetMargin >= 0.95)) {
            throw new BadRequestException('Parâmetro "targetMargin" deve estar entre 0 e 0.95.');
        }

        let raw;
        try {
            raw = await this.pricingAdapter.getListingPrices({ price, categoryId, listingTypeId });
        } catch (error) {
            throw new BadGatewayException(
                `Falha ao consultar custos no Mercado Livre: ${error?.response?.data?.message || error.message}`,
            );
        }

        const listingTypes = this.pricingAdapter.compareListingTypes(raw, price, cost);

        let suggestion: { targetMargin: number; listingTypeId: string; suggestedPrice: number } | null = null;
        if (targetMargin !== undefined && cost !== undefined) {
            // Default the suggestion to the Clássico fee curve (or the explicitly requested type).
            const suggestTypeId = listingTypeId || 'gold_special';
            const feeLookup = async (candidatePrice: number): Promise<number> => {
                const r = await this.pricingAdapter.getListingPrices({
                    price: candidatePrice,
                    categoryId,
                    listingTypeId: suggestTypeId,
                });
                return r[0]?.sale_fee_amount ?? 0;
            };
            const { suggestedPrice } = await this.pricingAdapter.suggestPriceForMargin({
                cost: cost ?? 0,
                targetMargin,
                feeLookup,
            });
            if (suggestedPrice !== null) {
                suggestion = { targetMargin, listingTypeId: suggestTypeId, suggestedPrice };
            }
        }

        return {
            currencyId: raw[0]?.currency_id ?? 'BRL',
            categoryId: categoryId ?? null,
            price,
            cost: cost ?? null,
            listingTypes,
            suggestion,
        };
    }
}
