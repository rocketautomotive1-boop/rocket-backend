import { z } from 'zod';
import { StockMovementType } from '../domain/movement-type';

export const StockMoveSchema = z.object({
  productId: z.string().min(1, 'productId é obrigatório'),
  type: z.nativeEnum(StockMovementType),
  quantity: z.number().int('quantidade deve ser inteira'),
  condition: z.enum(['new', 'damaged', 'used', 'refurbished']).default('new'),
  unitCost: z.number().nonnegative().optional(),
  /** Snapshot do preço de venda vigente neste movimento (vai em metadata.salePrice).
   *  Nunca confundir com unitCost (custo do lote). */
  salePrice: z.number().nonnegative().optional(),
  fromBoxId: z.string().optional(),
  toBoxId: z.string().optional(),
  reference: z.string().optional(),
  reason: z.string().optional(),
  orderId: z.string().optional(),
  origin: z.object({ type: z.string(), location: z.string() }).optional(),
});

export type StockMoveInput = z.infer<typeof StockMoveSchema>;
