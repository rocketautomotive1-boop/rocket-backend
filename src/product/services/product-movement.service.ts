import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductRepository } from '../product.repository';
import { CreateProductMovementDto } from '../dto/create-product-movement.dto';
import { UpdateProductMovementDto } from '../dto/update-product-movement.dto';
import { QueueService } from '../../queue/queue.service';
import { BoxService } from './box.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRODUCT_SECTION_EVENTS, ProductInventorySavedEvent } from '../events/product-section-saved.event';

export function resolveMovementCondition(
  condition?: 'new' | 'used' | 'refurbished',
  legacyId?: number,
): 'new' | 'used' | 'refurbished' {
  if (condition === 'used' || condition === 'refurbished' || condition === 'new') return condition;
  if (legacyId === 2) return 'used';
  if (legacyId === 3) return 'refurbished';
  return 'new';
}

function legacyNumericForBox(condition: string): number {
  if (condition === 'used') return 2;
  if (condition === 'refurbished') return 3;
  return 1;
}

@Injectable()
export class ProductMovementService {
  private readonly logger = new Logger(ProductMovementService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    @Inject(forwardRef(() => BoxService))
    private readonly boxService: BoxService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  async findAll(
    productId?: string,
    type?: string,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const query: any = {};

    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      const product = await this.productRepository.findById(productId);
      if (product) {
        query.product = product._id;
      } else {
        return [];
      }
    }

    if (type) query.type = type;

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const movements = await this.productRepository.findMovements(query);
    return this.mapMovements(movements);
  }

  async findOne(id: any): Promise<any> {
    const movement = await this.productRepository.findMovementById(id);
    if (!movement) {
      throw new NotFoundException(`Movimentação de produto com ID ${id} não encontrada`);
    }
    return this.mapMovement(movement);
  }

  async findByProduct(productId: string): Promise<any[]> {
    if (!productId) return [];

    if (!Types.ObjectId.isValid(productId)) return [];
    const product = await this.productRepository.findById(productId);
    if (!product) return [];

    const movements = await this.productRepository.findMovements({ product: product._id });
    return this.mapMovements(movements);
  }

  /**
   * Última entrada de estoque: condição e situação para templates de descrição / regras de anúncio.
   * Não usa o campo `condition` do cadastro do produto.
   */
  async getListingStockSnapshot(productId: string): Promise<{ condition: string; situation: string; observation: string } | null> {
    if (!Types.ObjectId.isValid(productId)) return null;
    const latest = await this.productRepository.findLatestInboundMovement(new Types.ObjectId(productId));
    if (!latest) return null;
    const raw: any = latest;
    const condition = resolveMovementCondition(raw.condition, raw.conditionId);
    return {
      condition,
      situation: raw.situation || 'normal',
      observation: raw.observation || '',
    };
  }

  async create(createMovementDto: CreateProductMovementDto, externalSession?: any): Promise<any> {
    if (typeof createMovementDto.productId === 'number' && isNaN(createMovementDto.productId)) {
      throw new BadRequestException('Invalid Product ID (NaN)');
    }

    let product;

    // Accept both string IDs and Mongoose ObjectId objects (the route handler passes product._id directly)
    const pidStr = createMovementDto.productId?.toString?.() ?? String(createMovementDto.productId ?? '');
    if (pidStr && Types.ObjectId.isValid(pidStr)) {
      product = await this.productRepository.findById(pidStr);
    }

    if (!product) {
      throw new NotFoundException(`Produto com ID ${createMovementDto.productId} não encontrado`);
    }

    // Use external session if provided, otherwise create local
    const session = externalSession || await this.productRepository.getConnection().startSession();
    if (!externalSession) session.startTransaction();

    try {
      const type = createMovementDto.type || 'inbound';
      const quantity = createMovementDto.quantity || 0;
      const resolvedCondition = resolveMovementCondition(
        createMovementDto.condition,
        createMovementDto.conditionId,
      );

      const savedMovement = await this.productRepository.createMovement({
        productId: product._id,
        orderId: createMovementDto.orderId ? new Types.ObjectId(createMovementDto.orderId) : undefined,
        type,
        quantity,
        date: new Date(),
        price: Types.Decimal128.fromString((createMovementDto.price || 0).toString()),
        reason: createMovementDto.reason || 'Manual Movement',
        fromAllocationId: (createMovementDto.fromAllocationId && Types.ObjectId.isValid(createMovementDto.fromAllocationId.toString()))
          ? new Types.ObjectId(createMovementDto.fromAllocationId.toString()) : undefined,
        toAllocationId: (createMovementDto.toAllocationId && Types.ObjectId.isValid(createMovementDto.toAllocationId.toString()))
          ? new Types.ObjectId(createMovementDto.toAllocationId.toString()) : undefined,

        condition: resolvedCondition,
        situation: createMovementDto.situation || 'normal',
        observation: createMovementDto.observation,

        origin: createMovementDto.origin,
        metadata: {
          externalReference: createMovementDto.reference,
          ...createMovementDto.metadata
        }
      }, session);

      // Atomic updates based on Type (stock is derived from movements, no denormalized field to update)
      // 1. Reservation: Increases StockReserved (Active Reservation)
      if (type === 'reservation') {
        await this.productRepository.updateStockReserved(product._id as any, quantity, session);
      }
      // 2. Outbound: Release reservation if fulfillment
      else if (type === 'outbound') {
        if (createMovementDto.metadata?.isFulfillment) {
          await this.productRepository.updateStockReserved(product._id as any, -quantity, session);
        }
        // If price is provided and valid, update product price
        if (createMovementDto.price && createMovementDto.price > 0) {
          await this.productRepository.updatePrice(product._id as any, createMovementDto.price, session);
        }
      }
      // 3. Inbound: Update product price if provided
      else if (type === 'inbound') {
        if (createMovementDto.price && createMovementDto.price > 0) {
          await this.productRepository.updatePrice(product._id as any, createMovementDto.price, session);
        }
      }

      // Auto-update Total Sold for sales/outbounds
      if (type === 'outbound') {
        await this.productRepository.updateTotalSold(product._id as any, quantity, session);
      }

      // NOVO: Garantir que o produto esteja na lista de produtos do box
      if (createMovementDto.boxId) {
        try {
          await this.boxService.addProductToBox(
            createMovementDto.boxId,
            product._id as any,
            legacyNumericForBox(resolvedCondition),
          );
        } catch (e) {
          this.logger.warn(`Falha ao associar produto ${product._id} ao box ${createMovementDto.boxId}: ${e.message}`);
        }
      }

      if (!externalSession) await session.commitTransaction();


      const mapped = this.mapMovement(savedMovement);

      try {
        this.eventEmitter.emit(
          PRODUCT_SECTION_EVENTS.INVENTORY_SAVED,
          new ProductInventorySavedEvent(product._id.toString()),
        );
      } catch {}

      return mapped;
    } catch (error) {
      if (!externalSession) await session.abortTransaction();
      this.logger.error(`Error creating movement for product ${createMovementDto.productId}: ${error.message}`);
      throw error;
    } finally {
      if (!externalSession) session.endSession();
    }
  }

  async update(id: any, updateMovementDto: UpdateProductMovementDto): Promise<any> {
    const movement = await this.productRepository.findMovementById(id);
    if (!movement) {
      throw new NotFoundException(`Movimentação não encontrada`);
    }

    const session = await this.productRepository.getConnection().startSession();
    session.startTransaction();

    try {
      const oldType = movement.type;
      const oldQty = movement.quantity || 0;

      if (updateMovementDto.quantity !== undefined) movement.quantity = updateMovementDto.quantity;
      if (updateMovementDto.type) movement.type = updateMovementDto.type;
      if (updateMovementDto.reason) movement.reason = updateMovementDto.reason;
      if (updateMovementDto.price !== undefined) movement.price = Types.Decimal128.fromString(updateMovementDto.price.toString());
      if (updateMovementDto.condition !== undefined) {
        (movement as any).condition = resolveMovementCondition(
          updateMovementDto.condition,
          updateMovementDto.conditionId,
        );
      }
      if (updateMovementDto.situation !== undefined) movement.situation = updateMovementDto.situation;
      if (updateMovementDto.observation !== undefined) movement.observation = updateMovementDto.observation;

      const saved = await this.productRepository.save(movement, session);

      const newType = saved.type;
      const newQty = saved.quantity || 0;

      // Adjust totalSold if outbound changed
      if (oldType === 'outbound' && newType !== 'outbound') {
        // logic to reduce... 
        await this.productRepository.updateTotalSold(movement.productId as any, -oldQty, session);
      }
      if (oldType !== 'outbound' && newType === 'outbound') {
        await this.productRepository.updateTotalSold(movement.productId as any, newQty, session);
      }
      // If quantity changed on outbound
      if (oldType === 'outbound' && newType === 'outbound' && oldQty !== newQty) {
        await this.productRepository.updateTotalSold(movement.productId as any, newQty - oldQty, session);
      }

      await session.commitTransaction();
      const mappedUpdate = this.mapMovement(saved);

      try {
        this.eventEmitter.emit(
          PRODUCT_SECTION_EVENTS.INVENTORY_SAVED,
          new ProductInventorySavedEvent((movement.productId as any).toString()),
        );
      } catch {}

      return mappedUpdate;
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`Error updating movement ${id}: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async remove(id: any): Promise<void> {
    const movement = await this.productRepository.findMovementById(id);
    if (!movement) return;

    const session = await this.productRepository.getConnection().startSession();
    session.startTransaction();

    try {
      const productId = movement.productId;
      const type = movement.type;
      const quantity = movement.quantity || 0;

      await this.productRepository.deleteMovement(id, session);

      // Revert Total Sold if it was outbound
      if (type === 'outbound') {
        await this.productRepository.updateTotalSold(productId as any, -quantity, session);
      }
      // Revert Reserved if it was reservation
      if (type === 'reservation') {
        await this.productRepository.updateStockReserved(productId as any, -quantity, session);
      }

      await session.commitTransaction();

      try {
        this.eventEmitter.emit(
          PRODUCT_SECTION_EVENTS.INVENTORY_SAVED,
          new ProductInventorySavedEvent((productId as any).toString()),
        );
      } catch {}
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`Error removing movement ${id}: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async processMovement(id: any): Promise<any> {
    return this.findOne(id);
  }

  async getMovementStatistics(
    productId?: string,
    startDate?: string,
    endDate?: string
  ) {
    const matchStage: any = {};

    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      const product = await this.productRepository.findById(productId);
      if (product) {
        matchStage.productId = product._id;
      } else {
        return [];
      }
    }

    if (startDate && endDate) {
      matchStage.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    return this.productRepository.aggregateMovements([
      { $match: matchStage },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' },
          avgQuantity: { $avg: '$quantity' }
        }
      },
      {
        $project: {
          type: '$_id',
          count: 1,
          totalQuantity: 1,
          avgQuantity: 1,
          _id: 0
        }
      }
    ]);
  }

  private mapMovement(doc: any) {
    if (!doc) return null;
    const raw = doc.toObject ? doc.toObject() : doc;
    const condition = resolveMovementCondition(raw.condition, raw.conditionId);
    return {
      id: doc._id.toString(),
      productId: doc.productId?.sku || doc.productId || doc.product, // handle legacy 'product' if mixed data
      type: doc.type,
      quantity: doc.quantity,
      price: doc.price ? parseFloat(doc.price.toString()) : 0,
      createdAt: doc.date,
      updatedAt: doc.updatedAt,
      fromAllocation: null,
      toAllocation: null,
      box: null,
      reason: doc.reason,
      situation: doc.situation || 'normal',
      condition,
      observation: doc.observation,
      orderId: doc.orderId,
      origin: doc.origin,
      metadata: doc.metadata
    };
  }

  private mapMovements(docs: any[]) {
    return docs.map(d => this.mapMovement(d));
  }
  async existsReference(reference: string): Promise<boolean> {
    if (!reference) return false;
    const movements = await this.productRepository.findMovements({ reference }, 1);
    return movements.length > 0;
  }
}

