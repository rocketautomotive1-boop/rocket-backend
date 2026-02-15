import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { CreateCompatibilityDto, CreateMultipleCompatibilitiesDto } from '../dto/create-compatibility.dto';
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class ProductCompatibilityService {
  private readonly logger = new Logger(ProductCompatibilityService.name);

  constructor(
    @InjectModel(ProductCompatibilityModel.name) private compatibilityModel: Model<ProductCompatibilityModel>,
  ) { }

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

      const compatibility = new this.compatibilityModel({
        ...createDto,
        product: createDto.productId
      });
      const savedCompatibility = await compatibility.save();

      this.logger.log(`Compatibilidade criada com sucesso: ${savedCompatibility.id}`);
      this.logger.log(` Detalhes da compatibilidade criada:`, {
        id: savedCompatibility.id,
        productId: savedCompatibility.product,
        vehicleId: savedCompatibility.vehicleId
      });

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
          vehicleName: vehicleDetails?.name,
          vehicleBrand: vehicleDetails?.brand,
          vehicleModel: vehicleDetails?.model,
          vehicleYear: vehicleDetails?.year,
          vehicleVersion: vehicleDetails?.version,
          vehicleEngine: vehicleDetails?.engine,
          vehicleFuelType: vehicleDetails?.fuelType,
          vehicleTransmission: vehicleDetails?.transmission,
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

      // 3. Preparar dados para inserção em batch (apenas productId)
      const compatibilitiesToInsert = newVehicleIds.map(vehicleId => {
        const vehicleDetails = createDto.vehicleDetails?.find(v => v.id === vehicleId);

        return {
          product: createDto.productId, // Map to product field
          vehicleId,
          vehicleName: vehicleDetails?.name,
          vehicleBrand: vehicleDetails?.brand,
          vehicleModel: vehicleDetails?.model,
          vehicleYear: vehicleDetails?.year,
          vehicleVersion: vehicleDetails?.version,
          vehicleEngine: vehicleDetails?.engine,
          vehicleFuelType: vehicleDetails?.fuelType,
          vehicleTransmission: vehicleDetails?.transmission,
          status: 'active',
          syncedWithMarketplace: false,
        };
      });

      // 4. Inserir em batch usando insertMany
      if (compatibilitiesToInsert.length > 0) {
        this.logger.log(` Inserindo ${compatibilitiesToInsert.length} compatibilidades em BATCH...`);

        const insertResult = await this.compatibilityModel.insertMany(compatibilitiesToInsert);

        this.logger.log(`✅ Inserção em BATCH concluída. IDs inseridos: ${insertResult.length}`);
      }

      // 5. Buscar todas as compatibilidades (existentes + novas) em uma única query
      const allCompatibilities = await this.getAllCompatibilities(createDto);

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

  async getCompatibilitiesByProduct(productId: string): Promise<ProductCompatibilityModel[]> {
    try {
      this.logger.debug(`Buscando compatibilidades para produto ID: ${productId}`);
      const query: any = { product: new Types.ObjectId(productId) };
      const results = await this.compatibilityModel.find(query).sort({ createdAt: -1 }).exec();
      this.logger.debug(`Encontradas ${results.length} compatibilidades para o produto ${productId}`);
      return results;
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
      const query = typeof id === 'string' && Types.ObjectId.isValid(id) ? { _id: id } : { productId: id as number };
      await this.compatibilityModel.deleteOne(query).exec();
      this.logger.log(`Compatibilidade ${id} deletada com sucesso`);
    } catch (error) {
      this.logger.error('Erro ao deletar compatibilidade:', error);
      throw new HttpException(
        'Erro ao deletar compatibilidade',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async markAsSynced(ids: Array<string | number>): Promise<void> {
    try {
      const stringIds = ids.filter(id => typeof id === 'string' && Types.ObjectId.isValid(id));
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
    } catch (error) {
      this.logger.error('Erro ao marcar compatibilidades como sincronizadas:', error);
      throw new HttpException(
        'Erro ao atualizar status de sincronização',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
