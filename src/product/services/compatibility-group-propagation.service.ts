import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { ProductModel } from '../schemas/product.schema';
import { CrossReferenceGroupModel } from '../schemas/cross-reference-group.schema';

/**
 * Quando um produto ganha uma compatibilidade nova, sugere a mesma compatibilidade para os
 * demais produtos ativos do seu cross_reference_group ('equivalence' — peças fisicamente
 * intercambiáveis entre marcas). Só propaga ADIÇÃO: remover uma compatibilidade em um produto
 * nunca remove nos irmãos, porque o motivo pode ser específico daquele SKU (erro de cadastro)
 * e não do fitment real. Sugestões nascem com needsReview:true — nunca substituem uma linha
 * 'manual' já existente para o mesmo par produto+veículo.
 * Ver debate em conversa 2026-07-24 (cross_reference_groups como fonte de propagação, não de
 * verdade — grupos 'kit' e casos regionais/motorização podem ter fitment divergente entre
 * peças "equivalentes", então a sugestão fica sempre revisável, não auto-confirmada).
 */
@Injectable()
export class CompatibilityGroupPropagationService {
  private readonly logger = new Logger(CompatibilityGroupPropagationService.name);

  constructor(
    @InjectModel(ProductCompatibilityModel.name) private compatibilityModel: Model<ProductCompatibilityModel>,
    @InjectModel(ProductModel.name) private productModel: Model<ProductModel>,
    @InjectModel(CrossReferenceGroupModel.name) private groupModel: Model<CrossReferenceGroupModel>,
  ) {}

  /**
   * Fire-and-forget: chamado depois que uma compatibilidade 'manual' é salva para `productId`.
   * Nunca lança — falha de propagação não pode derrubar o fluxo de cadastro de compatibilidade.
   */
  async propagate(productId: string, vehicleId: string): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(productId)) return;

      const sourceProduct = await this.productModel
        .findById(productId)
        .select('crossReferenceGroupId')
        .lean()
        .exec();
      const groupId = sourceProduct?.crossReferenceGroupId;
      if (!groupId) return;

      const group = await this.groupModel.findById(groupId).select('status groupType').lean().exec();
      // Só grupos de equivalência ativa: 'kit' é peça diferente (montagem vs. componente avulso),
      // 'conflict' significa que a própria composição do grupo está sob revisão.
      if (!group || group.status !== 'active' || group.groupType !== 'equivalence') return;

      const siblings = await this.productModel
        .find({ crossReferenceGroupId: groupId, _id: { $ne: productId }, active: true })
        .select('_id')
        .lean()
        .exec();
      if (siblings.length === 0) return;

      const siblingIds = siblings.map((p) => p._id);
      const alreadyLinked = await this.compatibilityModel
        .find({ product: { $in: siblingIds } as any, vehicleId })
        .select('product')
        .lean()
        .exec();
      const alreadyLinkedSet = new Set(alreadyLinked.map((c) => String(c.product)));

      const toInsert = siblingIds
        .filter((id) => !alreadyLinkedSet.has(String(id)))
        .map((id) => ({
          product: id,
          vehicleId,
          origin: 'group-suggestion' as const,
          sourceGroupId: groupId,
          needsReview: true,
          status: 'active',
          syncedWithMarketplace: false,
        }));

      if (toInsert.length === 0) return;

      await this.compatibilityModel.insertMany(toInsert, { ordered: false });
      this.logger.log(
        `Propagadas ${toInsert.length} sugestão(ões) de compatibilidade (veículo ${vehicleId}) a partir do produto ${productId}, grupo ${groupId}`,
      );
    } catch (error) {
      this.logger.warn(`Falha ao propagar compatibilidade do produto ${productId} para o grupo: ${(error as Error)?.message}`);
    }
  }
}
