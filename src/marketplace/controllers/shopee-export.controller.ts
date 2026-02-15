import { Controller, Get, Query, BadRequestException, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import { ProductModel, ProductDocument, ProductTitle } from '../../product/product-types';
import { StockMovementModel as ProductMovement, StockMovementDocument } from '../../product/schemas/stock-movement.schema';
// import { Marketplace } from '../entities/marketplace.entity';
import { MarketplaceIntegrationHelperService } from '../services/marketplace-integration-helper.service';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { ListingService } from '../../listing/listing.service'; // [FIX]
import { ListingDocument } from '../../listing/schemas/listing.schema'; // [FIX]

@ApiTags('marketplaces/shopee')
@Controller('marketplaces/shopee')
export class ShopeeExportController {
  constructor(
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    private readonly marketplaceIntegrationHelperService: MarketplaceIntegrationHelperService,
    private readonly listingService: ListingService, // [NEW]
  ) { }

  @Get('products/export-csv')
  @ApiOperation({ summary: 'Exportar CSV de upload de produtos para a Shopee' })
  @ApiResponse({ status: 200, description: 'CSV gerado e retornado com sucesso.' })
  async exportShopeeProductsCsv(
    @Res() res: Response,
    @Query('categoryId') categoryId?: string,
  ): Promise<any> {
    const defaultCategory = categoryId || '102284';

    // [REF] Fetch published products via Listings
    // 1. Get all listings with externalId
    const allListings = await this.listingService.listingModel.find({
      externalId: { $nin: [null, ''] }
    }).lean().exec() as unknown as ListingDocument[];

    const publishedProductIds = [...new Set(allListings.map(l => l.productId.toString()))];

    if (publishedProductIds.length === 0) {
      return this.sendEmptyCsv(res);
    }

    // 2. Fetch Products
    const products = await this.productModel.find({
      _id: { $in: publishedProductIds }
    }).exec();

    if (!products || products.length === 0) {
      return this.sendEmptyCsv(res);
    }

    const titleByProductId = new Map<string, any>();

    // Group listings by product
    const listingsByProduct = new Map<string, ListingDocument[]>();
    for (const l of allListings) {
      const pid = l.productId.toString();
      if (!listingsByProduct.has(pid)) listingsByProduct.set(pid, []);
      listingsByProduct.get(pid)?.push(l);
    }

    for (const p of products) {
      const pid = p._id.toString(); // Use _id as key
      const pListings = listingsByProduct.get(pid) || [];

      // Logic: Prefer Shopee title, then any title
      const shopeeListing = pListings.find(l => l.marketplaceId && (l as any).marketplaceName === 'Shopee'); // marketplaceName might not be populated?
      // Check marketplaceId if we know Shopee's ID. Assuming we don't know it hardcoded, we rely on finding *any* or specific if possible.
      // If we don't have marketplaceName populated, we might miss 'Shopee' check.
      // But filtering by 'any' is the fallback.

      const anyListing = pListings.find(l => l.externalId); // Matches loop criteria

      if (shopeeListing || anyListing) {
        titleByProductId.set(pid, shopeeListing || anyListing);
        // Also set by SKU for compatibility if needed
        if (p.sku) titleByProductId.set(String(p.sku), shopeeListing || anyListing);
        // if (p.sku) titleByProductId.set(Number(p.sku), shopeeListing || anyListing); // REMOVED: Map key must be string
      }
    }

    const header = this.buildShopeeCsvHeader();
    const rows: string[] = [];

    for (const product of products) {
      const selectedTitle = titleByProductId.get(product._id.toString())?.title || titleByProductId.get(String(product.sku))?.title || product.name || '';
      const description = selectedTitle;
      const stock = product.stockQuantity || 0;
      const imagesOrdered = (product.images || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const coverImage = imagesOrdered[0]?.url || '';
      const imgUrls = imagesOrdered.slice(0, 8).map(img => img.url);
      const paddedImgs = Array.from({ length: 8 }, (_, i) => imgUrls[i] || '');
      const price = this.resolveProductPrice(product);
      const skuNum = Number(product.sku) || 0;
      const fictitiousWeight = this.generateFictitiousWeight(skuNum);
      const dims = this.generateFictitiousDimensions(skuNum, fictitiousWeight);

      const rowValues = [
        defaultCategory,
        selectedTitle,
        description || '',
        String(product.sku || ''),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        price,
        stock,
        '',
        '',
        '',
        product.barcode || '',
        '',
        coverImage,
        ...paddedImgs,
        fictitiousWeight,
        dims.length,
        dims.width,
        dims.height,
        '',
        '',
        product.tax?.ncm || '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ];

      rows.push(rowValues.map(v => this.csvEscape(v)).join(','));
    }

    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shopee_upload.csv"');
    return res.send(csv);
  }

  private sendEmptyCsv(res: Response) {
    const emptyCsv = '\uFEFF' + this.buildShopeeCsvHeader() + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shopee_upload.csv"');
    return res.send(emptyCsv);
  }

  private buildShopeeCsvHeader(): string {
    return [
      'Categoria',
      'Nome do Produto',
      'Descrição do Produto',
      'SKU principal',
      'Mercadorias Perigosas',
      'Número de Integração de Variação',
      'Nome da Variação 1',
      'Opção para Variação 1',
      'Imagem por Variação',
      'Nome da Variação 2',
      'Opção para Variação 2',
      'Preço',
      'Estoque',
      'SKU da Variação',
      'Template da Tabela de Medidas',
      'Imagem de Tamanhos',
      'GTIN (EAN)',
      'IDs de compatibilidade',
      'Imagem de capa',
      'Imagem do produto 1',
      'Imagem do produto 2',
      'Imagem do produto 3',
      'Imagem do produto 4',
      'Imagem do produto 5',
      'Imagem do produto 6',
      'Imagem do produto 7',
      'Imagem do produto 8',
      'Peso',
      'Comprimento',
      'Largura',
      'Altura',
      'Correios',
      'Prazo de Postagem para Encomenda',
      'NCM',
      'CFOP (Mesmo Estado)',
      'CFOP (Outro Estado)',
      'Origem',
      'CSOSN',
      'CEST',
      'Unidade de Medida',
      'CST PIS/Cofins',
      '% total de tributos federais, estaduais e municipais',
      'Tipo de Operação',
      'EX TIPI (tabela de exceções IPI)',
      'Nr. de controle da FCI',
      'Nr. RECOPI',
      'Informações adicionais do produto',
      'Produto é um item agrupável',
      'GTIN da Unidade Tributável',
      'Quantidade da Unidade Tributável',
      'Unidade de medida do item agrupável',
      'Motivo da Falha',
    ].join(',');
  }

  private csvEscape(value: any): string {
    const v = value === null || value === undefined ? '' : String(value);
    const needsQuotes = /[",\n]/.test(v);
    let safe = v.replace(/"/g, '""');
    if (needsQuotes) safe = `"${safe}"`;
    return safe;
  }

  private resolveProductPrice(product: ProductDocument): number {
    const directPrice = (product as any).price ? Number((product as any).price.toString()) : 0;
    return directPrice;
  }

  private generateFictitiousWeight(productId: number): number {
    const base = productId % 11; // inteiro entre 0 e 10
    return base;
  }

  private generateFictitiousDimensions(productId: number, weightKg: number): { length: number; width: number; height: number } {
    const w = Math.max(0, Math.floor(weightKg));
    // Dimensões em centímetros, escaladas pelo peso fictício
    const length = 10 + w * 5; // 10..60 cm
    const width = 8 + w * 4;   // 8..48 cm
    const height = 6 + w * 3;  // 6..36 cm
    return { length, width, height };
  }
}