import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import { MercadoLivreCompatibilityAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';
import { ProductModel } from '../../product/schemas/product.schema';
import { CategoryModel } from '../../product/schemas/category.schema';
import { BrandModel } from '../../product/schemas/brand.schema';
import { ProductCompatibilityModel } from '../../product/schemas/product-compatibility.schema';
import { VehicleCompatibilityModel } from '../../vehicle-compatibility/schemas/vehicle-compatibility.schema';
import { buildProductCompatibilitySearchText } from '../../product/utils/product-compatibility-search.util';
import {
  CatalogImportCandidateDto,
  CatalogImportDraftDto,
  CatalogImportSearchResultDto,
  ConfirmCatalogImportDto,
} from '../dto/product-catalog-import.dto';

/** Escapa caracteres especiais de regex — brandName vem de fora (catálogo ML), não confiar. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface MlCatalogAttribute {
  id: string;
  name?: string;
  value_id?: string;
  value_name?: string;
}

interface MlCatalogProduct {
  id: string;
  name: string;
  domain_id?: string;
  category_id?: string;
  pictures?: Array<{ url: string }>;
  attributes?: MlCatalogAttribute[];
}

/**
 * Orquestra o pré-cadastro de produto via catálogo do Mercado Livre (busca por EAN).
 * Ver docs/superpowers/specs/2026-07-15-product-catalog-import-design.md.
 *
 * search  → candidatos por GTIN, sem gravar nada.
 * resolve → monta rascunho completo (atributos, posição, veículos); só os veículos são
 *           gravados imediatamente (cache reutilizável via upsertByCanonicalKey).
 * confirm → cria/enriquece produto + compatibilidades numa transação; nada gravado antes
 *           deste passo, exceto os veículos já resolvidos no resolve.
 */
@Injectable()
export class ProductCatalogImportService {
  private readonly logger = new Logger(ProductCatalogImportService.name);

  constructor(
    private readonly mlCompatAdapter: MercadoLivreCompatibilityAdapter,
    private readonly configCache: MarketplaceConfigCacheService,
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
    @InjectModel(CategoryModel.name) private readonly categoryModel: Model<CategoryModel>,
    @InjectModel(BrandModel.name) private readonly brandModel: Model<BrandModel>,
    @InjectModel(ProductCompatibilityModel.name) private readonly compatibilityModel: Model<ProductCompatibilityModel>,
    @InjectModel(VehicleCompatibilityModel.name) private readonly vehicleModel: Model<VehicleCompatibilityModel>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async search(ean: string): Promise<CatalogImportSearchResultDto> {
    const results = await this.mlCompatAdapter.searchCatalogProductsByGtin(ean);

    const candidates: CatalogImportCandidateDto[] = results.map((r: any) => ({
      catalogProductId: r.catalog_product_id ?? r.id,
      name: r.name,
      domainId: r.domain_id,
      categoryId: r.category_id,
      brandName: this.findAttrValue(r.attributes, 'BRAND'),
      thumbnail: r.pictures?.[0]?.url,
    }));

    return { candidates };
  }

  async resolve(catalogProductId: string): Promise<CatalogImportDraftDto> {
    const product: MlCatalogProduct | null = await this.mlCompatAdapter.getCatalogProduct(catalogProductId);
    if (!product) {
      throw new BadRequestException(`Produto de catálogo ${catalogProductId} não encontrado no Mercado Livre.`);
    }

    const knownAttrIds = new Set(['BRAND', 'PART_NUMBER', 'POSITION', 'SIDE_POSITION']);
    const attrs = product.attributes ?? [];

    const brandName = this.findAttrValue(attrs, 'BRAND');
    const partNumber = this.findAttrValue(attrs, 'PART_NUMBER');
    const position = this.findAttrValueId(attrs, 'POSITION');
    const positionName = this.findAttrName(attrs, 'POSITION');
    const sidePosition = this.findAttrValueId(attrs, 'SIDE_POSITION');
    const sidePositionName = this.findAttrName(attrs, 'SIDE_POSITION');

    const extraAttributes = attrs
      .filter((a) => !knownAttrIds.has(a.id))
      .map((a) => ({ id: a.id, name: a.name ?? a.id, value: a.value_name ?? a.value_id ?? '' }))
      .filter((a) => !!a.value);

    const images = (product.pictures ?? []).map((p) => p.url).filter(Boolean);

    const [suggestedCategoryId, vehiclesResult] = await Promise.all([
      this.resolveSuggestedCategory(product.category_id),
      this.resolveVehicles(catalogProductId),
    ]);

    return {
      catalogProductId,
      name: product.name,
      brandName,
      partNumber,
      attributes: extraAttributes,
      images,
      suggestedCategoryId,
      position: position || sidePosition ? { position, positionName, sidePosition, sidePositionName } : undefined,
      vehicleIds: vehiclesResult.upserted.map((v: any) => String(v._id)),
      vehiclesSkipped: vehiclesResult.skipped,
    };
  }

  async confirm(dto: ConfirmCatalogImportDto): Promise<{ productId: string }> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      let productId: string;

      if (dto.productId) {
        productId = await this.enrichExistingProduct(dto, session);
      } else {
        productId = await this.createNewProduct(dto, session);
      }

      await this.attachCompatibilities(productId, dto.name, dto.vehicleIds, session);

      await session.commitTransaction();
      return { productId };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  private async createNewProduct(dto: ConfirmCatalogImportDto, session: any): Promise<string> {
    if (!dto.partNumber) {
      throw new BadRequestException('partNumber é obrigatório para criar produto novo a partir do catálogo ML.');
    }

    const brand = await this.resolveOrCreateBrand(dto, session);

    const created = await this.productModel.create(
      [
        {
          name: dto.name,
          partNumber: dto.partNumber,
          brand: { _id: String(brand._id), name: brand.name },
          category: dto.suggestedCategoryId ? new Types.ObjectId(dto.suggestedCategoryId) : undefined,
          images: dto.images.map((url, i) => ({ url, order: i, main: i === 0, status: 'active' })),
          attributes: dto.attributes.map((a) => ({ name: a.name, value: a.value, code: a.id })),
          active: true,
        },
      ],
      { session },
    );

    return String(created[0]._id);
  }

  /**
   * Resolve a marca do produto: usa brandId se o vendedor escolheu uma marca existente no
   * select; senão, busca por brandName (case-insensitive) e cria automaticamente se não
   * existir — sem fricção, mesmo princípio já usado nos veículos (cache reutilizável em vez
   * de bloquear o fluxo por falta de cadastro prévio). Ver
   * docs/superpowers/specs/2026-07-15-product-catalog-import-design.md.
   */
  private async resolveOrCreateBrand(dto: ConfirmCatalogImportDto, session: any): Promise<{ _id: any; name: string }> {
    if (dto.brandId) {
      const existing = await this.brandModel.findById(dto.brandId).session(session).lean().exec();
      if (!existing) throw new BadRequestException(`Marca ${dto.brandId} não encontrada.`);
      return existing;
    }

    const brandName = dto.brandName?.trim();
    if (!brandName) {
      throw new BadRequestException('Informe brandId ou brandName para resolver a marca do produto.');
    }

    const existingByName = await this.brandModel
      .findOne({ name: new RegExp(`^${escapeRegExp(brandName)}$`, 'i') })
      .session(session)
      .lean()
      .exec();
    if (existingByName) return existingByName;

    const created = await this.brandModel.create([{ name: brandName, active: true, isGenuine: false }], { session });
    return created[0];
  }

  private async enrichExistingProduct(dto: ConfirmCatalogImportDto, session: any): Promise<string> {
    const product = await this.productModel.findById(dto.productId).session(session).exec();
    if (!product) {
      throw new BadRequestException(`Produto ${dto.productId} não encontrado.`);
    }

    // Nunca sobrescreve campo já preenchido manualmente — mesmo princípio de
    // "manual sempre vence" usado em vehicle_compatibilities (origin: MANUAL).
    if (!product.images?.length && dto.images.length) {
      product.images = dto.images.map((url, i) => ({ url, order: i, main: i === 0, status: 'active' })) as any;
    }
    if (!product.attributes?.length && dto.attributes.length) {
      product.attributes = dto.attributes.map((a) => ({ name: a.name, value: a.value, code: a.id })) as any;
    }
    if (!product.category && dto.suggestedCategoryId) {
      product.category = new Types.ObjectId(dto.suggestedCategoryId) as any;
    }

    await product.save({ session });
    return String(product._id);
  }

  /**
   * Cria as linhas de product_compatibilities diretamente (sem passar por
   * ProductCompatibilityService.createCompatibility, que não é session-aware) para que
   * tudo participe da mesma transação do confirm — atomicidade real entre produto e
   * compatibilidades.
   */
  private async attachCompatibilities(
    productId: string,
    productName: string,
    vehicleIds: string[],
    session: any,
  ): Promise<void> {
    if (!vehicleIds.length) return;

    const existing = await this.compatibilityModel
      .find({ productId, vehicleId: { $in: vehicleIds } })
      .select('vehicleId')
      .session(session)
      .lean()
      .exec();
    const alreadyLinked = new Set(existing.map((r: any) => r.vehicleId));

    const newVehicleIds = vehicleIds.filter((id) => !alreadyLinked.has(id));
    if (!newVehicleIds.length) return;

    const vehicles = await this.vehicleModel
      .find({ _id: { $in: newVehicleIds } })
      .session(session)
      .lean()
      .exec();
    const vehicleById = new Map(vehicles.map((v: any) => [String(v._id), v]));

    const productObjectId = new Types.ObjectId(productId);
    const rows = newVehicleIds.map((vehicleId) => {
      const vehicle = vehicleById.get(vehicleId);
      return {
        product: productObjectId,
        productId,
        vehicleId,
        vehicleName: vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.versionDisplay ?? vehicle.version}` : undefined,
        mlVehicleId: vehicle?.mlVehicleId,
        syncedWithMarketplace: false,
        searchText: buildProductCompatibilitySearchText({ name: productName }, vehicle as any),
      };
    });

    await this.compatibilityModel.insertMany(rows, { session });
  }

  /**
   * DESATIVADO (2026-07-15): não existe endpoint confirmado do ML para resolver a lista de
   * veículos compatíveis a partir de um catalog_product_id de PEÇA. Testado ao vivo:
   * `catalog_product_id`/`product_id` no payload de POST /catalog_compatibilities/
   * products_search/chunks é silenciosamente ignorado — a chamada sempre devolve a árvore
   * inteira de MLB-CARS_AND_VANS (~36 mil resultados), independente do valor passado (mesmo
   * um id inexistente produz o mesmo total). Também testados sem sucesso:
   * known_attributes com CATALOG_PRODUCT_ID, GET /catalog_compatibilities/{id}, GET
   * /products/{id}/items (sem vencedores), busca pública /sites/MLB/search (403, API
   * bloqueada p/ não-donos). Fica desativado até um endpoint real ser confirmado — o vendedor
   * continua vinculando compatibilidades manualmente pela tela normal depois de criado o
   * produto. Ver docs/superpowers/specs/2026-07-15-product-catalog-import-design.md.
   */
  private async resolveVehicles(_catalogProductId: string): Promise<{ upserted: any[]; skipped: number }> {
    return { upserted: [], skipped: 0 };
  }

  private async resolveSuggestedCategory(mlCategoryId?: string): Promise<string | undefined> {
    if (!mlCategoryId) return undefined;

    const mlId = await this.configCache.resolveId('mercadolivre');
    if (!mlId) return undefined;

    const category = await this.categoryModel
      .findOne({
        marketplaceMappings: {
          $elemMatch: { marketplaceId: new Types.ObjectId(mlId), externalId: mlCategoryId },
        },
      })
      .select('_id')
      .lean()
      .exec();

    return category ? String((category as any)._id) : undefined;
  }

  private findAttrValue(attrs: MlCatalogAttribute[] | undefined, id: string): string | undefined {
    const attr = attrs?.find((a) => a.id === id);
    return attr?.value_name ?? attr?.value_id;
  }

  /** value_id do atributo (ex: POSITION → "13701105") — distinto do value_name (nome de exibição). */
  private findAttrValueId(attrs: MlCatalogAttribute[] | undefined, id: string): string | undefined {
    return attrs?.find((a) => a.id === id)?.value_id;
  }

  private findAttrName(attrs: MlCatalogAttribute[] | undefined, id: string): string | undefined {
    return attrs?.find((a) => a.id === id)?.value_name;
  }
}
