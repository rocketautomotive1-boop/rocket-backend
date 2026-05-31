// backend/src/general-product/validation/ean13.ts

/**
 * Valida um código de barras EAN-13 (GTIN-13).
 * Regra: 13 dígitos; o 13º é o dígito verificador, calculado pela soma
 * ponderada (peso 1 e 3 alternados a partir da esquerda) dos 12 primeiros,
 * sendo o verificador = (10 - (soma mod 10)) mod 10.
 */
export function isValidEan13(barcode: string): boolean {
  if (typeof barcode !== 'string' || !/^\d{13}$/.test(barcode)) return false;

  const digits = barcode.split('').map(Number);
  const check = digits[12];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}
