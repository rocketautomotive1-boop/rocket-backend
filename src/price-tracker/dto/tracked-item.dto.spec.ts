import {
  createTrackedItemSchema, updateTrackedItemSchema,
  createTrackedCategorySchema, updateTrackedCategorySchema,
} from './tracked-item.dto';

const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';

describe('createTrackedItemSchema', () => {
  it('aceita EAN-13 e EAN-8 com nome', () => {
    expect(createTrackedItemSchema.parse({ ean: '7896000001504', name: 'Coca' }).ean).toBe('7896000001504');
    expect(createTrackedItemSchema.parse({ ean: '12345678', name: 'X' }).ean).toBe('12345678');
  });

  it('rejeita EAN com tamanho errado ou não-numérico, com mensagem em português', () => {
    const bad = createTrackedItemSchema.safeParse({ ean: '123', name: 'X' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toMatch(/EAN/);
    expect(createTrackedItemSchema.safeParse({ ean: '78960000015AB', name: 'X' }).success).toBe(false);
  });

  it('nome é opcional (scan preenche do desc da API), mas vazio explícito é rejeitado', () => {
    expect(createTrackedItemSchema.parse({ ean: '7896000001504' }).name).toBeUndefined();
    expect(createTrackedItemSchema.safeParse({ ean: '7896000001504', name: '' }).success).toBe(false);
  });

  it('rejeita targetPrice negativo; aplica default do threshold', () => {
    expect(createTrackedItemSchema.safeParse({ ean: '7896000001504', name: 'X', targetPrice: -1 }).success).toBe(false);
    const ok = createTrackedItemSchema.parse({ ean: '7896000001504' });
    expect(ok.discountThresholdPct).toBe(15);
  });
});

describe('updateTrackedItemSchema', () => {
  it('patch parcial: aceita subset e rejeita threshold fora de 1..90', () => {
    expect(updateTrackedItemSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateTrackedItemSchema.safeParse({ discountThresholdPct: 0 }).success).toBe(false);
    expect(updateTrackedItemSchema.safeParse({ discountThresholdPct: 91 }).success).toBe(false);
  });

  it('targetPrice aceita null (remover teto)', () => {
    expect(updateTrackedItemSchema.parse({ targetPrice: null })).toEqual({ targetPrice: null });
  });

  it('categoryId aceita ObjectId válido ou null (remover categoria); rejeita string arbitrária', () => {
    expect(updateTrackedItemSchema.parse({ categoryId: VALID_OBJECT_ID }).categoryId).toBe(VALID_OBJECT_ID);
    expect(updateTrackedItemSchema.parse({ categoryId: null }).categoryId).toBeNull();
    expect(updateTrackedItemSchema.safeParse({ categoryId: 'not-an-id' }).success).toBe(false);
  });
});

describe('createTrackedCategorySchema / updateTrackedCategorySchema', () => {
  it('aceita nome não vazio até 40 caracteres', () => {
    expect(createTrackedCategorySchema.parse({ name: 'Limpeza' }).name).toBe('Limpeza');
    expect(updateTrackedCategorySchema.parse({ name: 'Bebidas' }).name).toBe('Bebidas');
  });

  it('rejeita nome vazio ou maior que 40 caracteres', () => {
    expect(createTrackedCategorySchema.safeParse({ name: '' }).success).toBe(false);
    expect(createTrackedCategorySchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
  });
});
