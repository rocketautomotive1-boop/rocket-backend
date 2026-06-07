import { Injectable } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, ClientSession, Types } from 'mongoose';
import { StockMovementModel, StockMovementDocument } from './schemas/stock-movement.schema';
import { StockLotModel, StockLotDocument, StockCondition } from './schemas/stock-lot.schema';
import { StockBalanceModel, StockBalanceDocument } from './schemas/stock-balance.schema';

@Injectable()
export class StockRepository {
  constructor(
    @InjectModel(StockMovementModel.name) public readonly movementModel: Model<StockMovementDocument>,
    @InjectModel(StockLotModel.name) public readonly lotModel: Model<StockLotDocument>,
    @InjectModel(StockBalanceModel.name) public readonly balanceModel: Model<StockBalanceDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  getConnection(): Connection {
    return this.connection;
  }

  async findOrCreateLot(
    productId: Types.ObjectId,
    condition: StockCondition,
    unitCost: Types.Decimal128,
    session?: ClientSession,
  ): Promise<StockLotDocument> {
    const existing = await this.lotModel.findOne({ productId, condition }).session(session ?? null);
    if (existing) return existing;
    const created = await this.lotModel.create([{ productId, condition, unitCost }], { session });
    return created[0];
  }

  async appendMovement(data: Partial<StockMovementModel>, session?: ClientSession): Promise<StockMovementDocument> {
    const created = await this.movementModel.create([data], { session });
    return created[0];
  }

  async applyBalanceDelta(
    lotId: Types.ObjectId,
    productId: Types.ObjectId,
    condition: StockCondition,
    boxId: Types.ObjectId | null,
    onHand: number,
    reserved: number,
    session?: ClientSession,
  ): Promise<void> {
    await this.balanceModel.updateOne(
      { lotId, boxId },
      { $inc: { onHand, reserved }, $setOnInsert: { productId, condition } },
      { upsert: true, session },
    );
  }

  async referenceExists(reference: string, session?: ClientSession): Promise<boolean> {
    const c = await this.movementModel
      .countDocuments({ 'metadata.externalReference': reference })
      .session(session ?? null);
    return c > 0;
  }
}
