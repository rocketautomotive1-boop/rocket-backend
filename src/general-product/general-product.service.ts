// backend/src/general-product/general-product.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { GeneralProductRepository } from './general-product.repository';
import { ProductModel } from '../product/schemas/product.schema';
import { isValidEan13 } from './validation/ean13';
import { deriveGeneralCompletion, GeneralCompletion } from '../product/completion/derive-general-completion';
import { UpdateGeneralProductPatch } from './dto/update-general-product.schema';

/**
 * Regras de domínio dos itens gerais (sobre o ProductModel unificado,
 * domain:'general'). Side effects (persistência) ficam no repositório; aqui só
 * validação e orquestração. Métodos atômicos ≤25 linhas.
 */
@Injectable()
export class GeneralProductService {
  constructor(private readonly repo: GeneralProductRepository) {}

  async register(data: Partial<ProductModel>): Promise<ProductModel> {
    this.assertValidBarcode(data.barcode);
    await this.assertBarcodeUnused(data.barcode!);
    return this.repo.create(data);
  }

  /** Garante o Product general do barcode (cria shell se preciso) e retorna o id. */
  async ensureByBarcode(barcode: string): Promise<{ productId: string }> {
    this.assertValidBarcode(barcode);
    return this.repo.ensureByBarcode(barcode);
  }

  /** Completude por seção, derivada dos campos finais (produto inexistente → tudo false). */
  async getCompletion(barcode: string): Promise<GeneralCompletion> {
    this.assertValidBarcode(barcode);
    const product = await this.repo.findByBarcode(barcode);
    return deriveGeneralCompletion(product);
  }

  /** Salva (upsert) os campos confirmados de uma seção. Não toca draftData. */
  async updateByBarcode(
    barcode: string,
    patch: UpdateGeneralProductPatch,
  ): Promise<ProductModel | null> {
    this.assertValidBarcode(barcode);
    return this.repo.updateByBarcode(barcode, patch as unknown as Partial<ProductModel>);
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
