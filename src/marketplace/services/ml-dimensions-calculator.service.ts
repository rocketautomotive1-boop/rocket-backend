import { Injectable } from '@nestjs/common';

const ML_PKG_MINS = {
  SELLER_PACKAGE_HEIGHT: { min: 1,  unit: 'cm' },
  SELLER_PACKAGE_WIDTH:  { min: 10, unit: 'cm' },
  SELLER_PACKAGE_LENGTH: { min: 15, unit: 'cm' },
  SELLER_PACKAGE_WEIGHT: { min: 50, unit: 'g'  },
} as const;

function clamp(value: number, min: number, unit: string): string {
  const rounded = Math.round(value);
  return `${rounded < min ? min : rounded} ${unit}`;
}

export interface MlPackageDimensions {
  SELLER_PACKAGE_HEIGHT: string;
  SELLER_PACKAGE_WIDTH: string;
  SELLER_PACKAGE_LENGTH: string;
  SELLER_PACKAGE_WEIGHT: string;
}

@Injectable()
export class MlDimensionsCalculatorService {
  calculate(
    dimensions: { height: number; width: number; length: number },
    weightKg: number,
  ): MlPackageDimensions {
    return {
      SELLER_PACKAGE_HEIGHT: clamp(dimensions.height, ML_PKG_MINS.SELLER_PACKAGE_HEIGHT.min, 'cm'),
      SELLER_PACKAGE_WIDTH:  clamp(dimensions.width,  ML_PKG_MINS.SELLER_PACKAGE_WIDTH.min,  'cm'),
      SELLER_PACKAGE_LENGTH: clamp(dimensions.length, ML_PKG_MINS.SELLER_PACKAGE_LENGTH.min, 'cm'),
      SELLER_PACKAGE_WEIGHT: clamp(weightKg * 1000,   ML_PKG_MINS.SELLER_PACKAGE_WEIGHT.min, 'g'),
    };
  }
}
