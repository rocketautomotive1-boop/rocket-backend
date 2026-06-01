import { z } from 'zod';

/**
 * Patch parcial do PUT /general-product/by-barcode/:barcode. Todos os campos
 * são opcionais (cada tela de seção salva só os seus). Campos controlados
 * (barcode, draftData, _id, slug, domain) NÃO são aceitos — `.strip()` os
 * remove silenciosamente. Mensagens em português.
 */

const brandSchema = z.object({
  name: z.string().min(1, 'Nome da marca não pode ser vazio.'),
  logoUrl: z.string().optional(),
  externalId: z.string().optional(),
});

const imageSchema = z.object({
  url: z.string().min(1, 'URL da imagem é obrigatória.'),
  main: z.boolean().optional(),
  order: z.number().optional(),
  status: z.string().optional(),
});

const taxSchema = z.object({
  ncm: z.string().optional(),
  cest: z.string().optional(),
  origin: z.string().optional(),
});

const perishableSchema = z.object({
  isPerishable: z.boolean().optional(),
  shelfLifeDays: z.number().optional(),
  expiryDate: z.string().optional(),
  batch: z.string().optional(),
});

const regulatorySchema = z.object({
  agency: z.enum(['ANVISA', 'MAPA', 'OTHER']).optional(),
  number: z.string().optional(),
});

export const updateGeneralProductSchema = z
  .object({
    // dados
    name: z.string().min(1, 'Nome não pode ser vazio.').optional(),
    brand: brandSchema.optional(),
    description: z.string().optional(),
    // imagens
    images: z.array(imageSchema).optional(),
    // preço/estoque
    price: z.number().min(0, 'Preço deve ser maior ou igual a zero.').optional(),
    costPrice: z.number().min(0, 'Custo deve ser maior ou igual a zero.').optional(),
    listPrice: z.number().min(0, 'Preço de tabela deve ser maior ou igual a zero.').optional(),
    quantity: z.number().int('Quantidade deve ser um inteiro.').min(0, 'Quantidade deve ser maior ou igual a zero.').optional(),
    // fiscal / regulatório
    ncm: z.string().optional(),
    tax: taxSchema.optional(),
    perishable: perishableSchema.optional(),
    regulatoryRegistration: regulatorySchema.optional(),
  })
  .strip(); // remove qualquer chave fora do schema (barcode, draftData, _id, slug, domain, etc.)

export type UpdateGeneralProductPatch = z.infer<typeof updateGeneralProductSchema>;

/** Valida e normaliza o patch; lança ZodError se inválido. */
export function parseUpdatePatch(body: unknown): UpdateGeneralProductPatch {
  return updateGeneralProductSchema.parse(body);
}
