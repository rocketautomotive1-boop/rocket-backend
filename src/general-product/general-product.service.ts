// backend/src/general-product/general-product.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { GeneralProductRepository } from './general-product.repository';
import { GeneralProductModel } from './schemas/general-product.schema';
import { isValidEan13 } from './validation/ean13';

/**
 * Regras de domínio do GeneralProduct. Side effects (persistência) ficam no
 * repositório; aqui só validação e orquestração. Métodos atômicos ≤25 linhas.
 */
@Injectable()
export class GeneralProductService {
  constructor(private readonly repo: GeneralProductRepository) {}

  async register(data: Partial<GeneralProductModel>): Promise<GeneralProductModel> {
    this.assertValidBarcode(data.barcode);
    await this.assertBarcodeUnused(data.barcode!);
    return this.repo.create(data);
  }

  private assertValidBarcode(barcode?: string): void {
    if (!barcode || !isValidEan13(barcode)) {
      throw new BadRequestException('Código de barras EAN-13 inválido.');
    }
  }

  private async assertBarcodeUnused(barcode: string): Promise<void> {
    const existing = await this.repo.findByBarcode(barcode);
    if (existing) {
      throw new ConflictException(`Já existe um produto com o código de barras ${barcode}.`);
    }
  }
}
