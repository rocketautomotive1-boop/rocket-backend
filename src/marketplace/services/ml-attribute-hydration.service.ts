import { Injectable } from '@nestjs/common';

export const ML_PKG_MINS: Record<string, { min: number; unit: string }> = {
  SELLER_PACKAGE_HEIGHT: { min: 1,  unit: 'cm' },
  SELLER_PACKAGE_WIDTH:  { min: 10, unit: 'cm' },
  SELLER_PACKAGE_LENGTH: { min: 15, unit: 'cm' },
  SELLER_PACKAGE_WEIGHT: { min: 50, unit: 'g'  },
};

export interface MlAttributePayloadDto {
  id: string;
  name: string;
  value: string;
  valueName?: string;
  valueType?: string;
}

/**
 * Valida um GTIN (EAN-8/12/13/14 / UPC) pelo dígito verificador GS1.
 * Aceita só dígitos nos comprimentos válidos e confere o check digit.
 */
export function isValidGtin(raw: any): boolean {
  const code = String(raw ?? '').trim();
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // Pesos 3/1 alternados a partir do dígito mais à direita (antes do verificador).
  let sum = 0;
  for (let i = digits.length - 1, mult = 3; i >= 0; i--, mult = mult === 3 ? 1 : 3) {
    sum += digits[i] * mult;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

@Injectable()
export class MlAttributeHydrationService {
  clampMlDimension(val: string, min: number, unit: string): string {
    const n = parseFloat(String(val ?? '').replace(unit, '').replace(',', '.').trim());
    if (!val || isNaN(n) || n < min) return `${min} ${unit}`;
    return `${Math.round(n)} ${unit}`;
  }

  hydrateMlValues(product: any, marketplaceId: string): Record<string, string> {
    const values: Record<string, string> = {};

    const attrs = product?.attribute || product?.attributes || [];
    if (Array.isArray(attrs)) {
      attrs.forEach((a: any) => {
        if (a.marketplaceId && String(a.marketplaceId) === String(marketplaceId)) {
          const key = a.code || a.id;
          if (key && a.value != null && String(a.value).trim() !== '') {
            values[String(key)] = String(a.value);
          }
        }
      });
    }

    const toDim = (v: any): string | null => {
      const n = Math.round(parseFloat(String(v ?? '').replace(',', '.')));
      return !isNaN(n) && n > 0 ? `${n} cm` : null;
    };
    const toWgt = (v: any): string | null => {
      const kg = parseFloat(String(v ?? '').replace(',', '.'));
      return !isNaN(kg) && kg > 0 ? `${Math.round(kg * 1000)} g` : null;
    };

    if (!values.PART_NUMBER && product?.partNumber) values.PART_NUMBER = String(product.partNumber);
    if (!values.OEM       && product?.partNumber) values.OEM       = String(product.partNumber);
    if (!values.MODEL     && product?.partNumber) values.MODEL     = String(product.partNumber);
    // Fluxo general (saúde/beleza/alimentos): produtos não têm partNumber, só EAN.
    // O ML ainda exige MODEL, então usamos o barcode (EAN) como modelo.
    if (!values.MODEL && product?.domain === 'general' && product?.barcode) {
      values.MODEL = String(product.barcode);
    }
    // GTIN: muitas categorias do ML exigem (item.attribute.missing_conditional_required).
    // Fornecemos a partir do barcode quando ele for um GTIN válido (check digit GS1) —
    // vale para qualquer domínio. Barcode inválido/ausente cai no fluxo de exemption.
    if (!values.GTIN && isValidGtin(product?.barcode)) {
      values.GTIN = String(product.barcode);
    }
    if (!values.SELLER_SKU && product?._id)      values.SELLER_SKU = String(product._id);
    if (!values.BRAND) {
      const brandName = product?.brand?.name || product?.brands?.name;
      if (brandName) values.BRAND = String(brandName);
    }

    const dimH = toDim(product?.dimensions?.height); if (dimH && !values.SELLER_PACKAGE_HEIGHT) values.SELLER_PACKAGE_HEIGHT = dimH;
    const dimW = toDim(product?.dimensions?.width);  if (dimW && !values.SELLER_PACKAGE_WIDTH)  values.SELLER_PACKAGE_WIDTH  = dimW;
    const dimL = toDim(product?.dimensions?.length); if (dimL && !values.SELLER_PACKAGE_LENGTH) values.SELLER_PACKAGE_LENGTH = dimL;
    const wgt  = toWgt(product?.weight);             if (wgt  && !values.SELLER_PACKAGE_WEIGHT) values.SELLER_PACKAGE_WEIGHT = wgt;

    return values;
  }

  applyMlDimensionClamping(values: Record<string, string>): void {
    Object.entries(ML_PKG_MINS).forEach(([key, { min, unit }]) => {
      if (values[key] !== undefined && values[key] !== '') {
        values[key] = this.clampMlDimension(values[key], min, unit);
      }
    });
  }

  computeMissingMlRequiredAttrs(rawSchema: any[], hydratedValues: Record<string, string>): string[] {
    const required = rawSchema.filter((a: any) => a?.tags?.required);
    return required
      .filter((attr: any) => {
        if (attr?.tags?.fixed && Array.isArray(attr?.values) && attr.values.length === 1) return false;
        const val = hydratedValues[String(attr.id)];
        return val === undefined || val === null || String(val).trim() === '';
      })
      .map((attr: any) => String(attr?.name || attr?.id || ''));
  }

  applyFixedSchemaValues(rawSchema: any[], values: Record<string, string>): void {
    rawSchema.forEach((def: any) => {
      if (def?.tags?.fixed && Array.isArray(def?.values) && def.values.length === 1 && !values[def.id]) {
        const fixedId = def.values[0]?.id;
        if (fixedId != null) values[String(def.id)] = String(fixedId);
      }
    });
  }

  buildMlAttributesPayload(hydratedValues: Record<string, string>, rawSchema: any[]): MlAttributePayloadDto[] {
    const validIds = new Set<string>([
      'SELLER_SKU', 'BRAND', 'MODEL', 'PART_NUMBER', 'OEM', 'GTIN',
      'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT',
    ]);
    rawSchema.forEach((a: any) => validIds.add(String(a.id)));

    return Object.entries(hydratedValues)
      .filter(([id, value]) => validIds.has(id) && value != null && String(value).trim() !== '')
      .map(([id, value]) => {
        const def = rawSchema.find((a: any) => String(a.id) === String(id));
        const finalValue = String(value);
        const valueName = def?.values?.find((v: any) => String(v.id) === finalValue)?.name;
        return { id, name: def?.name ?? id, value: finalValue, valueName, valueType: def?.value_type };
      });
  }

  productHasSavedMlAttrsForCategory(product: any, marketplaceId: string, externalCategoryId: string): boolean {
    const attrs: any[] = product?.attribute || product?.attributes || [];
    if (!Array.isArray(attrs)) return false;
    return attrs.some(
      (a) =>
        a?.marketplaceId &&
        String(a.marketplaceId) === String(marketplaceId) &&
        a?.externalCategory != null &&
        String(a.externalCategory) === String(externalCategoryId),
    );
  }
}
