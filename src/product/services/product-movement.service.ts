import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductRepository } from '../product.repository';
import { CreateProductMovementDto } from '../dto/create-product-movement.dto';
import { UpdateProductMovementDto } from '../dto/update-product-movement.dto';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class ProductMovementService {
  private readonly logger = new Logger(ProductMovementService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
  ) { }

  async findAll(
    productId?: string,
    type?: string,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const query: any = {};

    if (productId) {
      if (!Types.ObjectId.isValid(productId) && isNaN(Number(productId))) return [];
      const product = await this.productRepository.findBySku(productId);
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

    const product = await this.productRepository.findBySku(productId);
    if (!product) return [];

    const movements = await this.productRepository.findMovements({ product: product._id });
    return this.mapMovements(movements);
  }

  async create(createMovementDto: CreateProductMovementDto, externalSession?: any): Promise<any> {
    if (typeof createMovementDto.productId === 'number' && isNaN(createMovementDto.productId)) {
      throw new BadRequestException('Invalid Product ID (NaN)');
    }

    let product;

    // Check if it's a valid ObjectId (string 24 hex)
    if (typeof createMovementDto.productId === 'string' && Types.ObjectId.isValid(createMovementDto.productId)) {
      product = await this.productRepository.findById(createMovementDto.productId);
    }

    // Fallback to SKU/PartNumber if not found or not ID
    if (!product) {
      product = await this.productRepository.findBySku(createMovementDto.productId);
    }

    if (!product) {
      throw new NotFoundException(`Produto com ID/SKU ${createMovementDto.productId} não encontrado`);
    }

    // Use external session if provided, otherwise create local
    const session = externalSession || await this.productRepository.getConnection().startSession();
    if (!externalSession) session.startTransaction();

    try {
      const type = createMovementDto.type || 'inbound';
      const quantity = createMovementDto.quantity || 0;

      const savedMovement = await this.productRepository.createMovement({
        productId: product._id,
        orderId: createMovementDto.orderId ? new Types.ObjectId(createMovementDto.orderId) : undefined,
        type,
        quantity,
        date: new Date(),
        // Derived legacy fields for debug if needed, but not in main schema
        from: createMovementDto.fromAllocationId ? `Alloc-${createMovementDto.fromAllocationId}` : (createMovementDto.origin?.location || 'External'),
        to: createMovementDto.toAllocationId ? `Alloc-${createMovementDto.toAllocationId}` : 'External',
        price: Types.Decimal128.fromString((createMovementDto.price || 0).toString()),
        reason: createMovementDto.reason || 'Manual Movement',
        origin: createMovementDto.origin,
        metadata: {
          externalReference: createMovementDto.reference,
          ...createMovementDto.metadata
        }
      }, session);

      // Atomic update based on Type
      // 1. Reservation: Increases StockReserved (Active Reservation)
      if (type === 'reservation') {
        await this.productRepository.updateStockReserved(product._id as any, quantity, session);
      }
      // 2. Outbound: Decreases StockQuantity (Physical)
      else if (type === 'outbound') {
        await this.productRepository.updateStock(product._id as any, -quantity, session);

        // If fulfilling a reservation (e.g. Order Processing), release the reservation
        // We assume "Order Outbound" implies release of previous reservation if explicit flag or orderId present?
        // For safety, let's look at `createMovementDto.metadata.fulfillment`.
        // Or just standard: If it is an Order Outbound, we decrease reserved too?
        // Let's rely on explicit instruction or default behavior for Orders.
        // User said: "apenas efetiva essa reserva para OUTBOUND".
        // Let's assume if orderId is set, it might be fulfillment.
        // Better: Check if `createMovementDto.metadata?.isFulfillment` is true.
        if (createMovementDto.metadata?.isFulfillment) {
          await this.productRepository.updateStockReserved(product._id as any, -quantity, session);
        }
      }
      // 3. Inbound: Increases StockQuantity
      else if (type === 'inbound') {
        await this.productRepository.updateStock(product._id as any, quantity, session);
        // If price is provided and valid, update product price
        if (createMovementDto.price && createMovementDto.price > 0) {
          await this.productRepository.updatePrice(product._id as any, createMovementDto.price, session);
        }
      }
      // 4. Adjustment: Signed quantity
      else if (type === 'adjustment') {
        await this.productRepository.updateStock(product._id as any, quantity, session);
      }

      // Auto-update Total Sold for sales/outbounds
      if (type === 'outbound') {
        await this.productRepository.updateTotalSold(product._id as any, quantity, session);
      }

      if (!externalSession) await session.commitTransaction();


      return this.mapMovement(savedMovement);
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

      const saved = await this.productRepository.save(movement, session);

      const newType = saved.type;
      const newQty = saved.quantity || 0;

      // Event Sourcing Sync
      // We accept that re-calculating whole history is safer than trying to compute delta
      await this.productRepository.syncStockFromMovements(movement.productId as any, session);

      // We still might need to adjust totalSold if outbound changed
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
      return this.mapMovement(saved);
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

      // Sync Stock
      await this.productRepository.syncStockFromMovements(productId as any, session);

      // Revert Total Sold if it was outbound
      if (type === 'outbound') {
        await this.productRepository.updateTotalSold(productId as any, -quantity, session);
      }
      // Revert Reserved if it was reservation
      if (type === 'reservation') {
        await this.productRepository.updateStockReserved(productId as any, -quantity, session);
      }

      await session.commitTransaction();
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
      const product = await this.productRepository.findBySku(productId);
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
      situation: 'normal',
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

