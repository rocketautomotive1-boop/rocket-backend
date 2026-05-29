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
      'SELLER_SKU', 'BRAND', 'MODEL', 'PART_NUMBER', 'OEM',
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
