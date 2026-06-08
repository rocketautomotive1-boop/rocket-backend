import { z } from 'zod';

export const SetBasePriceSchema = z.object({
  productId: z.string().min(1, 'productId é obrigatório'),
  price: z.number().nonnegative('preço deve ser maior ou igual a zero'),
});
export type SetBasePriceInput = z.infer<typeof SetBasePriceSchema>;

export const SetOverrideSchema = z.object({
  productId: z.string().min(1, 'productId é obrigatório'),
  marketplaceId: z.string().min(1, 'marketplaceId é obrigatório'),
  price: z.number().nonnegative('preço deve ser maior ou igual a zero'),
});
export type SetOverrideInput = z.infer<typeof SetOverrideSchema>;
