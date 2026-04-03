import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AllocationModel, AllocationDocument } from '../schemas/allocation.schema';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { StockMovementModel, StockMovementDocument } from '../schemas/stock-movement.schema';
import { ProductRepository } from '../product.repository';
import { CreateProductAllocationDto } from '../dto/create-product-allocation.dto';
import { UpdateProductAllocationDto } from '../dto/update-product-allocation.dto';

const PRODUCT_SELECT = 'partNumber price costPrice listPrice brands images sku';

function toNumber(val: any): number {
  if (val == null) return 0;
  // Mongoose Decimal128 (lean) has toString()
  const str = typeof val === 'object' && val.toString ? val.toString() : String(val);
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

@Injectable()
export class ProductAllocationService {
  constructor(
    @InjectModel(AllocationModel.name) private allocationModel: Model<AllocationDocument>,
    @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
    @InjectModel(StockMovementModel.name) private stockMovementModel: Model<StockMovementDocument>,
    private readonly productRepository: ProductRepository,
  ) { }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private handleDuplicateKeyError(error: any): never {
    if (error.code === 11000) {
      throw new ConflictException('Já existe uma alocação com este caminho neste armazém');
    }
    throw error;
  }

  async findAll(): Promise<AllocationDocument[]> {
    return this.allocationModel.find().exec();
  }

  async findOne(id: string): Promise<AllocationDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('ID inválido');
    const allocation = await this.allocationModel.findById(id).exec();
    if (!allocation) throw new NotFoundException('Alocação não encontrada');
    return allocation;
  }

  async findAvailable(): Promise<AllocationDocument[]> {
    return this.allocationModel.find({ available: true, active: true }).exec();
  }

  async create(createAllocationDto: CreateProductAllocationDto): Promise<AllocationDocument> {
    try {
      const created = new this.allocationModel(createAllocationDto);
      return await created.save();
    } catch (error: any) {
      this.handleDuplicateKeyError(error);
    }
  }

  async update(id: string, updateAllocationDto: UpdateProductAllocationDto): Promise<AllocationDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('ID inválido');
    try {
      const updated = await this.allocationModel.findByIdAndUpdate(id, updateAllocationDto, { new: true }).exec();
      if (!updated) throw new NotFoundException('Alocação não encontrada');
      return updated;
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.handleDuplicateKeyError(error);
    }
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('ID inválido');
    const deleted = await this.allocationModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Alocação não encontrada');
  }

  async toggleAvailability(id: string): Promise<AllocationDocument> {
    const allocation = await this.findOne(id);
    allocation.available = !allocation.available;
    return allocation.save();
  }

  async toggleActive(id: string): Promise<AllocationDocument> {
    const allocation = await this.findOne(id);
    allocation.active = !allocation.active;
    return allocation.save();
  }

  async findByPath(pathPrefix: string): Promise<AllocationDocument[]> {
    return this.allocationModel.find({
      locationPath: { $regex: new RegExp(`^${this.escapeRegex(pathPrefix)}`) }
    }).exec();
  }

  async findExactPath(path: string): Promise<AllocationDocument | null> {
    return this.allocationModel.findOne({ locationPath: path }).exec();
  }

  parseAllocationQr(qr: string): { locationPath?: string; allocationId?: string; metadata?: any } {
    const trimmed = (qr ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('QR Code vazio');
    }

    // Caso 1: QR é um ObjectId válido → busca direta por ID
    if (Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
      return { allocationId: trimmed };
    }

    // Caso 2: QR contém "/" e NÃO começa com "ALLOC" → tratar como locationPath puro
    if (trimmed.includes('/') && !trimmed.toUpperCase().startsWith('ALLOC')) {
      return { locationPath: trimmed };
    }

    // Caso 3: Formato estruturado "ALLOC;PATH=..." ou "ALLOC;FLOOR=1;ROOM=2;..."
    const parts = trimmed.split(';').map(p => p.trim());
    if (!parts[0] || !parts[0].toUpperCase().startsWith('ALLOC')) {
      throw new BadRequestException('QR Code inválido para Allocation. Formatos aceitos: ObjectId, locationPath (ex: F1/R2/ROW3/S1/L1), ou ALLOC;PATH=...');
    }

    let locationPath = '';
    const metadata: any = {};

    for (let i = 1; i < parts.length; i++) {
      const [key, value] = parts[i].split('=');
      if (!key) continue;
      const k = key.toUpperCase();
      const v = (value ?? '').trim();

      if (k === 'PATH') {
        locationPath = v;
      } else {
        metadata[k.toLowerCase()] = v;
      }
    }

    // Construir path a partir dos componentes se PATH não foi fornecido
    if (!locationPath && Object.keys(metadata).length > 0) {
      const p = [];
      if (metadata.floor) p.push(`F${metadata.floor}`);
      if (metadata.room) p.push(`R${metadata.room}`);
      if (metadata.row) p.push(`ROW${metadata.row}`);
      if (metadata.shelf) p.push(`S${metadata.shelf}`);
      if (metadata.level) p.push(`L${metadata.level}`);
      locationPath = p.join('/');
    }

    if (!locationPath) throw new BadRequestException('Não foi possível identificar o caminho de alocação pelo QR');

    return { locationPath, metadata };
  }


  async scanAllocation(qr: string, warehouseId?: string, dryRun?: boolean): Promise<any> {
    const parsed = this.parseAllocationQr(qr);

    // Busca por ID direto
    if (parsed.allocationId) {
      const existing = await this.allocationModel.findById(parsed.allocationId).exec();
      if (existing) {
        return { allocation: existing, isNew: false };
      }
      throw new NotFoundException('Alocação não encontrada para o ID informado');
    }

    // Busca por locationPath
    const { locationPath, metadata } = parsed;
    const existing = await this.allocationModel.findOne({ locationPath });

    if (existing) {
      return { allocation: existing, isNew: false };
    }

    if (dryRun) {
      return {
        allocation: null,
        isNew: true,
        parsed: { locationPath, metadata }
      };
    }

    // Criação real requer warehouseId
    if (!warehouseId) {
      throw new BadRequestException('warehouseId é obrigatório para criar alocação via scan');
    }

    try {
      const created = new this.allocationModel({
        warehouseId: new Types.ObjectId(warehouseId),
        locationPath,
        metadata,
        available: true,
        active: true
      });
      const saved = await created.save();
      return { allocation: saved, isNew: true };
    } catch (error: any) {
      this.handleDuplicateKeyError(error);
    }
  }

  async getAllocationProducts(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('ID inválido');

    // .lean() returns raw MongoDB doc — bypasses Mongoose schema hydration issues
    const allocation = await this.allocationModel.findById(id).lean().exec();
    if (!allocation) throw new NotFoundException('Alocação não encontrada');

    const rawBoxes: any[] = allocation.boxes || [];

    // Collect all product IDs from raw MongoDB data
    const allProductIds: string[] = [];
    for (const box of rawBoxes) {
      const prods = box.products || [];
      for (const p of prods) {
        allProductIds.push(String(p));
      }
    }

    const uniqueIds = [...new Set(allProductIds)];

    const products = uniqueIds.length > 0
      ? await this.productModel.find({ _id: { $in: uniqueIds } }).select(PRODUCT_SELECT).lean().exec()
      : [];

    const productMap = new Map(products.map(p => [String(p._id), p]));

    // Always fetch latest movement price/costPrice for all products
    const movementPriceMap = new Map<string, { price: number; costPrice: number }>();
    if (uniqueIds.length > 0) {
      const latestMovements = await this.stockMovementModel.aggregate([
        { $match: { productId: { $in: uniqueIds.map(id => new Types.ObjectId(id)) } } },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: '$productId',
            price: { $first: '$price' },
            costPrice: { $first: '$costPrice' },
          },
        },
      ]).exec();

      for (const m of latestMovements) {
        movementPriceMap.set(String(m._id), {
          price: toNumber(m.price),
          costPrice: toNumber(m.costPrice),
        });
      }
    }

    let totalItems = 0;
    let totalValue = 0;

    const boxes = await Promise.all(rawBoxes.map(async (box) => {
      const rawProducts = box.products || [];
      const matchedProducts = rawProducts
        .map((pid: any) => productMap.get(String(pid)))
        .filter(Boolean);

      const boxProducts = await Promise.all(matchedProducts.map(async (p: any) => {
          const pid = String(p._id);
          const quantity = Math.max(await this.productRepository.calculateStock(pid), 1);

          const movPrices = movementPriceMap.get(pid);
          let price = movPrices?.price || movPrices?.costPrice || toNumber(p.price) || toNumber(p.costPrice) || toNumber(p.listPrice);
          let costPrice = movPrices?.costPrice || toNumber(p.costPrice);

          totalItems += quantity;
          totalValue += price * quantity;
          return {
            ...p,
            id: pid,
            price,
            costPrice,
            quantity,
          };
        }));

      return {
        id: String(box._id),
        _id: String(box._id),
        code: box.code,
        description: box.description,
        itemsCount: box.itemsCount || 0,
        products: boxProducts,
        boxTotal: boxProducts.reduce((sum: number, p: any) => sum + p.price * p.quantity, 0),
        boxItemCount: boxProducts.reduce((sum: number, p: any) => sum + p.quantity, 0),
      };
    }));

    return {
      allocation: {
        id: String(allocation._id),
        locationPath: allocation.locationPath,
        metadata: allocation.metadata,
        available: allocation.available,
        active: allocation.active,
        warehouseId: allocation.warehouseId,
      },
      boxes,
      totals: {
        totalBoxes: rawBoxes.length,
        totalItems,
        totalValue,
      },
    };
  }
}
