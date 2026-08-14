import { z } from 'zod';

const eanSchema = z
  .string()
  .regex(/^(\d{8}|\d{13})$/, 'EAN deve ter 8 ou 13 dígitos numéricos');

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

export const createTrackedItemSchema = z.object({
  ean: eanSchema,
  // Opcional: o scan preenche o nome com o `desc` da API do Menor Preço.
  name: z.string().min(1, 'Nome não pode ser vazio').optional(),
  targetPrice: z.number().positive('Preço-alvo deve ser positivo').optional(),
  discountThresholdPct: z
    .number().int().min(1, 'Mínimo 1%').max(90, 'Máximo 90%')
    .default(15),
});

export const updateTrackedItemSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').optional(),
  targetPrice: z.number().positive('Preço-alvo deve ser positivo').nullable().optional(),
  discountThresholdPct: z.number().int().min(1, 'Mínimo 1%').max(90, 'Máximo 90%').optional(),
  active: z.boolean().optional(),
  // null = remove da categoria ("Todas").
  categoryId: objectIdSchema.nullable().optional(),
});

export const createTrackedCategorySchema = z.object({
  name: z.string().min(1, 'Nome da categoria é obrigatório').max(40, 'Máximo 40 caracteres'),
});

export const updateTrackedCategorySchema = z.object({
  name: z.string().min(1, 'Nome da categoria é obrigatório').max(40, 'Máximo 40 caracteres'),
});

export type CreateTrackedItemDto = z.infer<typeof createTrackedItemSchema>;
export type UpdateTrackedItemDto = z.infer<typeof updateTrackedItemSchema>;
export type CreateTrackedCategoryDto = z.infer<typeof createTrackedCategorySchema>;
