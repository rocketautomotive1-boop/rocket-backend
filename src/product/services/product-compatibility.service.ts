import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { ProductModel } from '../schemas/product.schema';
import { CreateCompatibilityDto, CreateMultipleCompatibilitiesDto } from '../dto/create-compatibility.dto';
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { buildProductCompatibilitySearchText } from '../utils/product-compatibility-search.util';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { VehicleCompatibilityDocument } from '../../vehicle-compatibility/schemas/vehicle-compatibility.schema';
import { ProductCompatibilityPositionService } from './product-compatibility-position.service';

@Injectable()
export class ProductCompatibilityService {
  private readonly logger = new Logger(ProductCompatibilityService.name);

  constructor(
    @InjectModel(ProductCompatibilityModel.name) private compatibilityModel: Model<ProductCompatibilityModel>,
    @InjectModel(ProductModel.name) private productModel: Model<ProductModel>,
    private vehicleCompatibilityService: VehicleCompatibilityService,
    private positionService: ProductCompatibilityPositionService,
  ) { }

  /** Busca em lote os veículos referenciados por vehicleId, indexados por _id (string). */
  private async resolveVehiclesByIds(vehicleIds: string[]): Promise<Map<string, VehicleCompatibilityDocument>> {
    const vehicles = await this.vehicleCompatibilityService.findManyByIds(vehicleIds);
    return new Map(vehicles.map((v: any) => [String(v._id), v]));
  }

  async createCompatibility(createDto: CreateCompatibilityDto): Promise<ProductCompatibilityModel> {
    try {
      this.logger.log(`Criando compatibilidade para veículo ${createDto.vehicleId}`);

      // Build search conditions
      const whereConditions: any = {
        vehicleId: createDto.vehicleId,
      };

      if (createDto.productId) {
        whereConditions.product = createDto.productId as any;
      }

      const existingCompatibility = await this.compatibilityModel.findOne(whereConditions).exec();

      if (existingCompatibility) {
        // Log removed for brevity or keep it if critical
        return existingCompatibility;
      }

      const vehicle = (await this.resolveVehiclesByIds([createDto.vehicleId])).get(createDto.vehicleId);
      const searchText = await this.buildSearchText(createDto, vehicle);

      const compatibility = new this.compatibilityModel({
        vehicleId: createDto.vehicleId,
        mlVehicleId: createDto.mlVehicleId,
        vehicleName: createDto.vehicleName,
        status: createDto.status,
        syncedWithMarketplace: createDto.syncedWithMarketplace,
        product: createDto.productId,
        searchText,
      });
      const savedCompatibility = await compatibility.save();

      this.logger.log(`Compatibilidade criada com sucesso: ${savedCompatibility.id}`);
      this.logger.log(` Detalhes da compatibilidade criada:`, {
        id: savedCompatibility.id,
        productId: savedCompatibility.product,
        vehicleId: savedCompatibility.vehicleId
      });

      if (createDto.productId) await this.recomputeCompatibilitySummary(createDto.productId);

      return savedCompatibility;
    } catch (error) {
      this.logger.error('Erro ao criar compatibilidade:', error);
      throw new HttpException(
        'Erro ao criar compatibilidade',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async createMultipleCompatibilities(createDto: CreateMultipleCompatibilitiesDto): Promise<ProductCompatibilityModel[]> {
    try {
      this.logger.log(`Criando ${createDto.vehicleIds.length} compatibilidades`);

      const compatibilities: any[] = [];

      for (const vehicleId of createDto.vehicleIds) {
        // Buscar detalhes do veículo se fornecidos
        const vehicleDetails = createDto.vehicleDetails?.find(v => v.id === vehicleId);

        const compatibilityData: CreateCompatibilityDto = {
          productId: createDto.productId,
          vehicleId,
          mlVehicleId: vehicleDetails?.mlVehicleId,
          vehicleName: vehicleDetails?.name,
          status: 'active',
          syncedWithMarketplace: false,
        };

        const compatibility = await this.createCompatibility(compatibilityData);
        compatibilities.push(compatibility);
      }

      this.logger.log(`${compatibilities.length} compatibilidades criadas com sucesso`);
      return compatibilities;
    } catch (error) {
      this.logger.error('Erro ao criar múltiplas compatibilidades:', error);
      throw new HttpException(
        'Erro ao criar compatibilidades',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async createMultipleCompatibilitiesBatch(createDto: CreateMultipleCompatibilitiesDto): Promise<ProductCompatibilityModel[]> {
    try {
      this.logger.log(` Iniciando inserção em BATCH para ${createDto.vehicleIds.length} compatibilidades`);

      const startTime = Date.now();

      // 1. Verificar compatibilidades existentes em uma única query (apenas productId)
      const existingCompatibilities = await this.getExistingCompatibilities(createDto);
      const existingVehicleIds = new Set(existingCompatibilities.map(c => c.vehicleId));

      this.logger.log(`📊 Compatibilidades existentes encontradas: ${existingCompatibilities.length}`);

      // 2. Filtrar apenas veículos que não existem
      const newVehicleIds = createDto.vehicleIds.filter(id => !existingVehicleIds.has(id));

      if (newVehicleIds.length === 0) {
        this.logger.log(`✅ Todas as ${createDto.vehicleIds.length} compatibilidades já existem`);
        return existingCompatibilities;
      }

      this.logger.log(`🆕 Compatibilidades novas a serem criadas: ${newVehicleIds.length}`);

      // 3. Buscar nome do produto e dados dos veículos (usados em todos os searchText do batch)
      const productName = createDto.productId ? await this.getProductName(createDto.productId) : undefined;
      const vehiclesById = await this.resolveVehiclesByIds(newVehicleIds);

      // 4. Preparar dados para inserção em batch (apenas productId)
      const compatibilitiesToInsert = newVehicleIds.map(vehicleId => {
        const vehicleDetails = createDto.vehicleDetails?.find(v => v.id === vehicleId);
        const vehicle = vehiclesById.get(vehicleId);

        return {
          product: createDto.productId ? new Types.ObjectId(createDto.productId) : undefined, // Map to product field
          vehicleId,
          mlVehicleId: vehicleDetails?.mlVehicleId,
          vehicleName: vehicleDetails?.name,
          status: 'active',
          syncedWithMarketplace: false,
          searchText: buildProductCompatibilitySearchText(
            { name: productName },
            vehicle
              ? {
                  make: vehicle.make,
                  model: vehicle.model,
                  version: vehicle.version,
                  versionDisplay: vehicle.versionDisplay,
                  years: vehicle.years,
                  aliases: vehicle.aliases,
                }
              : undefined,
          ),
        };
      });

      // 5. Inserir em batch usando insertMany
      if (compatibilitiesToInsert.length > 0) {
        this.logger.log(` Inserindo ${compatibilitiesToInsert.length} compatibilidades em BATCH...`);

        const insertResult = await this.compatibilityModel.insertMany(compatibilitiesToInsert);

        this.logger.log(`✅ Inserção em BATCH concluída. IDs inseridos: ${insertResult.length}`);
      }

      // 6. Buscar todas as compatibilidades (existentes + novas) em uma única query
      const allCompatibilities = await this.getAllCompatibilities(createDto);

      if (createDto.productId) await this.recomputeCompatibilitySummary(createDto.productId);

      const endTime = Date.now();
      const duration = endTime - startTime;

      this.logger.log(` BATCH concluído em ${duration}ms. Total de compatibilidades: ${allCompatibilities.length}`);

      return allCompatibilities;
    } catch (error) {
      this.logger.error('❌ Erro na inserção em BATCH:', error);
      throw new HttpException(
        'Erro ao criar compatibilidades em batch',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async getExistingCompatibilities(createDto: CreateMultipleCompatibilitiesDto): Promise<any[]> {
    const whereConditions: any = {
      vehicleId: { $in: createDto.vehicleIds },
    };

    if (createDto.productId) {
      whereConditions.product = new Types.ObjectId(createDto.productId);
    }

    return await this.compatibilityModel.find(whereConditions).exec();
  }

  // Função auxiliar para buscar todas as compatibilidades
  private async getAllCompatibilities(createDto: CreateMultipleCompatibilitiesDto): Promise<any[]> {
    const whereConditions: any = {
      vehicleId: { $in: createDto.vehicleIds },
    };

    if (createDto.productId) {
      whereConditions.product = new Types.ObjectId(createDto.productId);
    }

    return await this.compatibilityModel.find(whereConditions).sort({ createdAt: -1 }).exec();
  }

  async createMultipleCompatibilitiesBatchChunked(
    createDto: CreateMultipleCompatibilitiesDto,
    chunkSize: number = 1000
  ): Promise<ProductCompatibilityModel[]> {
    try {
      this.logger.log(` Iniciando inserção em BATCH com CHUNKING para ${createDto.vehicleIds.length} compatibilidades`);

      const startTime = Date.now();
      const allCompatibilities: any[] = [];

      // Dividir em chunks para evitar problemas de memória e timeout
      const chunks = this.chunkArray(createDto.vehicleIds, chunkSize);

      this.logger.log(`📦 Processando ${chunks.length} chunks de ${chunkSize} itens cada`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        this.logger.log(`🔄 Processando chunk ${i + 1}/${chunks.length} com ${chunk.length} itens`);

        const chunkDto: CreateMultipleCompatibilitiesDto = {
          ...createDto,
          vehicleIds: chunk,
          vehicleDetails: createDto.vehicleDetails?.filter(v => chunk.includes(v.id))
        };

        const chunkResult = await this.createMultipleCompatibilitiesBatch(chunkDto);
        allCompatibilities.push(...chunkResult);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      this.logger.log(` BATCH com CHUNKING concluído em ${duration}ms. Total: ${allCompatibilities.length} compatibilidades`);

      return allCompatibilities;
    } catch (error) {
      this.logger.error('❌ Erro na inserção em BATCH com CHUNKING:', error);
      throw new HttpException(
        'Erro ao criar compatibilidades em batch com chunking',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async getCompatibilitiesByProduct(productId: string): Promise<any[]> {
    try {
      this.logger.debug(`Buscando compatibilidades para produto ID: ${productId}`);
      const query: any = { product: new Types.ObjectId(productId) };
      const results = await this.compatibilityModel.find(query).sort({ createdAt: -1 }).lean().exec();
      this.logger.debug(`Encontradas ${results.length} compatibilidades para o produto ${productId}`);

      const vehiclesById = await this.resolveVehiclesByIds(results.map((r: any) => r.vehicleId));
      return results.map((r: any) => {
        const vehicle = vehiclesById.get(r.vehicleId);
        return {
          ...r,
          vehicle: vehicle
            ? {
                make: vehicle.make,
                model: vehicle.model,
                version: vehicle.version,
                versionDisplay: vehicle.versionDisplay,
                years: vehicle.years,
                engine: vehicle.engine,
                fuelType: vehicle.fuelType,
                transmission: vehicle.transmission,
                doors: vehicle.doors,
                engineDisplay: vehicle.engineDisplay,
                trim: vehicle.trim,
                traction: vehicle.traction,
                cabType: vehicle.cabType,
              }
            : undefined,
        };
      });
    } catch (error) {
      this.logger.error('Erro ao buscar compatibilidades do produtoo:', error);
      throw new HttpException(
        'Erro ao buscar compatibilidades',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async deleteCompatibility(id: string | number): Promise<void> {
    try {
      const query = { _id: id };
      const existing = await this.compatibilityModel.findOne(query).exec();
      await this.compatibilityModel.deleteOne(query).exec();
      this.logger.log(`Compatibilidade ${id} deletada com sucesso`);

      const productId = existing?.productId ?? (existing?.product ? String(existing.product) : undefined);
      if (productId) await this.recomputeCompatibilitySummary(productId);
    } catch (error) {
      this.logger.error('Erro ao deletar compatibilidade:', error);
      throw new HttpException(
        'Erro ao deletar compatibilidade',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /** Remove várias compatibilidades de uma vez, recomputando o summary do produto UMA única vez. */
  async deleteMultipleCompatibilities(ids: Array<string | number>): Promise<void> {
    if (!ids.length) return;
    try {
      const existing = await this.compatibilityModel.find({ _id: { $in: ids } }).exec();
      await this.compatibilityModel.deleteMany({ _id: { $in: ids } }).exec();
      this.logger.log(`${ids.length} compatibilidade(s) deletada(s) em lote`);

      const productIds = [...new Set(
        existing
          .map((c) => c.productId ?? (c.product ? String(c.product) : undefined))
          .filter((id): id is string => !!id),
      )];
      await Promise.all(productIds.map((productId) => this.recomputeCompatibilitySummary(productId)));
    } catch (error) {
      this.logger.error('Erro ao deletar compatibilidades em lote:', error);
      throw new HttpException(
        'Erro ao deletar compatibilidades em lote',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async markAsSynced(ids: Array<string | number>): Promise<void> {
    try {
      const stringIds = ids.filter((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id));
      const numericIds = ids.filter(id => typeof id === 'number');

      const query: any = {};
      if (stringIds.length > 0 && numericIds.length > 0) {
        query.$or = [{ _id: { $in: stringIds } }, { productId: { $in: numericIds } }];
      } else if (stringIds.length > 0) {
        query._id = { $in: stringIds };
      } else if (numericIds.length > 0) {
        query.productId = { $in: numericIds };
      } else {
        return;
      }

      await this.compatibilityModel.updateMany(
        query,
        {
          syncedWithMarketplace: true,
          lastSyncAt: new Date()
        }
      ).exec();
      this.logger.log(`${ids.length} compatibilidades marcadas como sincronizadas`);

      // Fire-and-forget: resolve posição de peça (POSITION/SIDE_POSITION) agora que a
      // linha está confirmada como sincronizada com o ML. Nunca bloqueia nem derruba
      // o markAsSynced — falha vira log, não exception (ver ProductCompatibilityPositionService).
      for (const id of stringIds) {
        this.positionService
          .resolveForCompatibility(id)
          .catch((err) => this.logger.warn(`Falha ao resolver posição da compatibilidade ${id}: ${err?.message}`));
      }
    } catch (error) {
      this.logger.error('Erro ao marcar compatibilidades como sincronizadas:', error);
      throw new HttpException(
        'Erro ao atualizar status de sincronização',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Recalcula compatibilitySummary (makes/models/vehicleCount) no Product a partir do estado
   * atual de product_compatibilities. Chamado de forma síncrona a cada mutação — ver
   * docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md, Seção 2.
   */
  async recomputeCompatibilitySummary(productId: string): Promise<void> {
    if (!Types.ObjectId.isValid(productId)) return;

    const rows = await this.compatibilityModel
      .find({ product: new Types.ObjectId(productId) } as any)
      .select('vehicleId')
      .lean()
      .exec();

    const vehiclesById = await this.resolveVehiclesByIds(rows.map((r: any) => r.vehicleId));
    const makes = [...new Set([...vehiclesById.values()].map((v: any) => v.make).filter(Boolean))];
    const models = [...new Set([...vehiclesById.values()].map((v: any) => v.model).filter(Boolean))];

    await this.productModel.updateOne(
      { _id: productId },
      {
        $set: {
          compatibilitySummary: {
            makes,
            models,
            vehicleCount: rows.length,
            updatedAt: new Date(),
          },
        },
      },
    ).exec();
  }

  private async getProductName(productId: string): Promise<string | undefined> {
    if (!Types.ObjectId.isValid(productId)) return undefined;
    const product = await this.productModel.findById(productId).select('name').lean().exec();
    return (product as any)?.name;
  }

  private async buildSearchText(
    dto: CreateCompatibilityDto,
    vehicle?: VehicleCompatibilityDocument,
  ): Promise<string> {
    const productName = dto.productId ? await this.getProductName(dto.productId) : undefined;
    return buildProductCompatibilitySearchText(
      { name: productName },
      vehicle
        ? {
            make: (vehicle as any).make,
            model: (vehicle as any).model,
            version: (vehicle as any).version,
            versionDisplay: (vehicle as any).versionDisplay,
            years: (vehicle as any).years,
            aliases: (vehicle as any).aliases,
          }
        : undefined,
    );
  }
}
