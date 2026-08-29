import { ClientSession } from 'mongoose';
import { StockMoveInput } from '../dto/stock-move.dto';

export const STOCK_WRITE_PORT = Symbol('STOCK_WRITE_PORT');

/**
 * Write side of stock, consumed by Product/Order/Fiscal via DI token — mirrors StockQueryPort's
 * role on the read side. Only the 3 methods actually called from outside StockModule; `adjust`
 * and `correctTo` stay internal (used by StockController and by these methods themselves).
 */
export interface StockWritePort {
  move(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }>;
  reverseMovement(movementId: string, fallbackStoreId?: string): Promise<{ movementId: string; lotId: string }>;
  editMovementViaAdjustment(
    movementId: string,
    newQuantity: number,
    fallbackStoreId?: string,
  ): Promise<{ movementId: string; lotId: string }>;
}
