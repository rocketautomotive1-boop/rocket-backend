import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductCompatibilityModel, ProductCompatibilityDocument, ProductModel, ProductDocument } from '../product/product-types';
import { CreateProductCompatibilityDto } from './dto/create-product-compatibility.dto';
import { SearchCompatibilitiesDto } from './dto/search-compatibilities.dto';
import { MercadoLivreCompatibilityAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { ProductTitleService } from '../product/services/product-title.service';

@Injectable()
export class CompatibilitiesService {
  private readonly logger = new Logger(CompatibilitiesService.name);

  constructor(
    @InjectModel(ProductCompatibilityModel.name)
    private readonly productCompatibilityModel: Model<ProductCompatibilityDocument>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly mercadoLivreCompatibilityAdapter: MercadoLivreCompatibilityAdapter,
    private readonly productTitleService: ProductTitleService,
  ) { }

  async create(createProductCompatibilityDto: CreateProductCompatibilityDto) {
    // Verificar se já existe compatibilidade para este produto e veículo
    const existingCompatibility = await this.productCompatibilityModel.findOne({
      productId: createProductCompatibilityDto.productId,
      vehicleId: createProductCompatibilityDto.vehicleId,
    }).exec();

    if (existingCompatibility) {
      this.logger.warn(`Compatibilidade já existe para produto ${createProductCompatibilityDto.productId} e veículo ${createProductCompatibilityDto.vehicleId}`);
      return existingCompatibility;
    }

    // Buscar o produto para obter o _id
    const product = await this.productModel.findById(createProductCompatibilityDto.productId).exec();
    if (!product) {
      throw new NotFoundException(`Produto ${createProductCompatibilityDto.productId} não encontrado`);
    }

    const compatibility = new this.productCompatibilityModel({
      ...createProductCompatibilityDto,
      product: product._id,
      productId: String(product._id),
    });
    const savedCompatibility = await compatibility.save();

    // Sincronizar com Mercado Livre após salvar
    await this.syncCompatibilityToMercadoLivre(createProductCompatibilityDto.productId, [createProductCompatibilityDto.vehicleId]);

    return savedCompatibility;
  }

  async createMany(createProductCompatibilityDtos: CreateProductCompatibilityDto[]) {
    if (createProductCompatibilityDtos.length === 0) {
      return [];
    }

    const productId = createProductCompatibilityDtos[0].productId;
    const vehicleIdsToSync = new Set<string>();

    try {
      // 1. Buscar todas as compatibilidades existentes para este produto de uma vez
      const existingCompatibilities = await this.productCompatibilityModel.find({
        productId
      }).select('vehicleId').exec();

      const existingVehicleIds = new Set(existingCompatibilities.map(comp => comp.vehicleId));

      // 2. Filtrar apenas as compatibilidades que não existem
      const newCompatibilities = createProductCompatibilityDtos.filter(dto =>
        !existingVehicleIds.has(dto.vehicleId)
      );

      if (newCompatibilities.length === 0) {
        this.logger.log(`Todas as compatibilidades para produto ${productId} já existem.`);
        return [];
      }

      // 3. Buscar o produto para obter o _id
      const product = await this.productModel.findById(productId).exec();
      if (!product) {
        throw new NotFoundException(`Produto ${productId} não encontrado`);
      }

      // 4. Salvar todas as novas compatibilidades em batch
      const compatibilitiesToSave = newCompatibilities.map(dto => ({
        ...dto,
        product: product._id,
        productId: String(product._id),
      }));

      const savedBatch = await this.productCompatibilityModel.insertMany(compatibilitiesToSave);

      // 5. Coletar IDs dos veículos para sincronização
      newCompatibilities.forEach(dto => vehicleIdsToSync.add(dto.vehicleId));

      this.logger.log(`Salvas ${savedBatch.length} compatibilidades em batch para produto ${productId}`);

      // 6. Sincronizar com Mercado Livre em background
      if (vehicleIdsToSync.size > 0) {
        this.syncCompatibilityToMercadoLivre(productId, Array.from(vehicleIdsToSync))
          .catch(error => {
            this.logger.error(`Erro na sincronização em background para produto ${productId}:`, error);
          });
      }

      return savedBatch;
    } catch (error) {
      this.logger.error(`Erro ao salvar compatibilidades em batch para produto ${productId}:`, error);
      throw error;
    }
  }

  async findAll(searchDto: SearchCompatibilitiesDto) {
    const filter: any = {};

    if (searchDto.productId) {
      filter.productId = searchDto.productId;
    }

    if (searchDto.vehicleId) {
      filter.vehicleId = searchDto.vehicleId;
    }

    if (searchDto.vehicleBrand) {
      filter.vehicleBrand = { $regex: searchDto.vehicleBrand, $options: 'i' };
    }

    if (searchDto.vehicleModel) {
      filter.vehicleModel = { $regex: searchDto.vehicleModel, $options: 'i' };
    }

    if (searchDto.vehicleYear) {
      filter.vehicleYear = searchDto.vehicleYear;
    }

    return this.productCompatibilityModel.find(filter).exec();
  }

  async findByProductId(productId: string) {
    return this.productCompatibilityModel.find({ productId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async remove(id: string) {
    const result = await this.productCompatibilityModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Compatibilidade com ID ${id} não encontrada`);
    }
    return { message: 'Compatibilidade removida com sucesso' };
  }

  async getVehicleBrands(): Promise<any[]> {
    // Buscar marcas usando o novo endpoint
    return this.getAttributeOptions('BRAND');
  }

  async searchCompatibleVehicles(searchDto: SearchCompatibilitiesDto): Promise<any> {
    // Buscar todos os resultados com paginação automática
    const result = await this.mercadoLivreCompatibilityAdapter.searchProductCompatibilities(searchDto, true);
    return result;
  }

  async getAttributeOptions(attributeId: string, knownAttributes: any[] = []): Promise<any[]> {
    try {
      this.logger.log(`Buscando opções para atributo ${attributeId} com known_attributes:`, JSON.stringify(knownAttributes));

      const response = await this.mercadoLivreCompatibilityAdapter.getAttributeTopValues(attributeId, knownAttributes);

      this.logger.log(`Resposta bruta do atributo ${attributeId}:`, JSON.stringify(response).substring(0, 500) + '...');

      // A resposta pode vir como array direto ou dentro de um objeto
      let values = [];

      if (Array.isArray(response)) {
        // Resposta direta como array
        values = response;
        this.logger.log(`Resposta é array direto com ${values.length} itens`);
      } else if (response && response.values && Array.isArray(response.values)) {
        // Resposta dentro de objeto com propriedade 'values'
        values = response.values;
        this.logger.log(`Resposta tem propriedade 'values' com ${values.length} itens`);
      } else if (response && Array.isArray(response.data)) {
        // Resposta dentro de objeto com propriedade 'data'
        values = response.data;
        this.logger.log(`Resposta tem propriedade 'data' com ${values.length} itens`);
      } else {
        this.logger.warn(`Estrutura de resposta inesperada para ${attributeId}:`, typeof response, response);
      }

      // Mapear os valores para o formato esperado
      let options = values.map((value: any) => ({
        id: value.id || value.value_id,
        name: value.name || value.value_name,
      }));

      // Ordenar anos do maior para o menor
      if (attributeId === 'VEHICLE_YEAR') {
        options = options.sort((a, b) => {
          const yearA = parseInt(a.name);
          const yearB = parseInt(b.name);
          return yearB - yearA; // Ordem decrescente (maior para menor)
        });
        this.logger.log(`Anos ordenados do maior para o menor: ${options.length} itens`);
      }

      this.logger.log(`Opções mapeadas para ${attributeId}: ${options.length} itens`);
      this.logger.log(`Primeiras 3 opções:`, options.slice(0, 3));

      return options;
    } catch (error) {
      this.logger.error(`Erro ao buscar opções do atributo ${attributeId}:`, error);
      throw error;
    }
  }

  private async syncCompatibilityToMercadoLivre(productId: string, vehicleIds: string[]) {
    try {
      // Buscar títulos do produto que tenham marketplace Mercado Livre
      const productTitles = await this.productTitleService.findByProductIdAndMarketplace(productId, 'Mercado Livre');

      if (productTitles.length === 0) {
        this.logger.warn(`Nenhum título encontrado para produto ${productId} no Mercado Livre`);
        return;
      }

      // Processar veículos em chunks para evitar sobrecarga da API
      const chunkSize = 50; // Mercado Livre aceita até 50 veículos por requisição
      const vehicleChunks = [];

      for (let i = 0; i < vehicleIds.length; i += chunkSize) {
        vehicleChunks.push(vehicleIds.slice(i, i + chunkSize));
      }

      this.logger.log(`Processando ${vehicleIds.length} veículos em ${vehicleChunks.length} chunks para produto ${productId}`);

      // Para cada título, sincronizar as compatibilidades em chunks
      for (const productTitle of productTitles) {
        if (!productTitle.externalId) {
          this.logger.warn(`Título ${productTitle.id} não possui externalId`);
          continue;
        }

        try {
          // Processar cada chunk de veículos
          for (let i = 0; i < vehicleChunks.length; i++) {
            const chunk = vehicleChunks[i];

            // Preparar payload para Mercado Livre
            const payload = {
              products: chunk.map(vehicleId => ({ id: vehicleId }))
            };

            this.logger.log(`Enviando chunk ${i + 1}/${vehicleChunks.length} para Mercado Livre - Item: ${productTitle.externalId}, Veículos: ${chunk.length}`);

            // Enviar para Mercado Livre
            await this.mercadoLivreCompatibilityAdapter.syncCompatibility(productTitle.externalId, payload);

            // Pequena pausa entre chunks para não sobrecarregar a API
            if (i < vehicleChunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          this.logger.log(`Todas as compatibilidades sincronizadas com sucesso para item ${productTitle.externalId}`);
        } catch (error) {
          this.logger.error(`Erro ao sincronizar compatibilidades para item ${productTitle.externalId}:`, error);
          // Não interromper o processo se um item falhar
        }
      }
    } catch (error) {
      this.logger.error(`Erro ao sincronizar compatibilidades para produto ${productId}:`, error);
      throw error;
    }
  }
}