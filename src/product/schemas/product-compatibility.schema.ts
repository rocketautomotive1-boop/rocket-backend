import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProductModel } from './product.schema';

export type ProductCompatibilityDocument = HydratedDocument<ProductCompatibilityModel>;

@Schema({ collection: 'product_compatibilities', timestamps: true })
export class ProductCompatibilityModel {
    id: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    product: ProductModel;

    /** _id do vehicle_compatibilities correspondente (base própria). */
    @Prop({ required: true, index: true })
    vehicleId: string;

    /** Id da taxonomia de catálogo do Mercado Livre — necessário para sync de volta ao ML. */
    @Prop({ index: true })
    mlVehicleId: string;

    @Prop()
    vehicleName: string;

    /**
     * @deprecated Granularidade errada — fica true globalmente por PRODUTO assim que
     * QUALQUER um dos listings/lojas do produto recebe sucesso no envio ao ML, mesmo que
     * outra loja do mesmo produto tenha falhado (bug confirmado ao vivo 2026-09-11: produto
     * com 2 StoreListings ML, 1 recebeu as 593 compatibilidades, a outra ficou com 0 —
     * ambas marcadas true igual). Não usar para decidir pendência; ver syncedExternalIds.
     * Mantido só por compatibilidade de leitura com dados antigos/scripts existentes.
     */
    @Prop({ default: false })
    syncedWithMarketplace: boolean;

    /**
     * externalId (item ML) de cada listing que já confirmou receber esta compatibilidade —
     * granularidade correta: um produto pode ter N listings (N lojas) no mesmo marketplace,
     * cada um com seu próprio estado de sync. "Pendente para o listing X" = X não está aqui.
     * Substitui syncedWithMarketplace para decidir o que reenviar (ver
     * ProductCompatibilityService.getUnsyncedExternalIds).
     */
    @Prop({ type: [String], default: [] })
    syncedExternalIds: string[];

    /** true quando a migração de dados legados não encontrou match em vehicle_compatibilities. */
    @Prop({ default: false })
    needsReview: boolean;

    /** catalog_product_id de PEÇA do ML (não o de veículo) resolvido para esta linha. */
    @Prop()
    mlCatalogProductId?: string;

    /** value_id do atributo POSITION do ML (ex: "13701105"), quando o domínio o define. */
    @Prop()
    position?: string;

    /** value_name do atributo POSITION (ex: "Traseira"), para exibição sem round-trip. */
    @Prop()
    positionName?: string;

    /** value_id do atributo SIDE_POSITION do ML (ex: "364128"). */
    @Prop()
    sidePosition?: string;

    /** value_name do atributo SIDE_POSITION (ex: "Esquerdo"). */
    @Prop()
    sidePositionName?: string;

    /**
     * true quando a resolução automática de mlCatalogProductId não encontrou match
     * exato único (0 ou 2+ candidatos com mesmo PART_NUMBER) — precisa de revisão
     * manual antes de confiar na posição. Mesma semântica de `needsReview`.
     */
    @Prop({ default: false })
    positionNeedsReview: boolean;

    /**
     * Texto de busca combinado (nome/oemCodes/EQUIVALENT_OEM do produto + marca/modelo/versão/
     * ano/aliases do veículo vinculado). Alimenta a busca única "palheta toro 2025" sem parsing
     * determinístico — ver docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md.
     */
    @Prop({ index: true })
    searchText?: string;

    /**
     * 'manual' (default): cadastrada diretamente para este produto. 'group-suggestion':
     * gerada automaticamente porque um produto irmão do mesmo cross_reference_group
     * (equivalência de código, ex. Tecfil PSL55 = Mann W940) ganhou esta compatibilidade —
     * ver CompatibilityGroupPropagationService. Nunca sobrescreve uma linha 'manual' existente.
     */
    @Prop({ type: String, enum: ['manual', 'group-suggestion'], default: 'manual' })
    origin?: 'manual' | 'group-suggestion';

    /** groupId de cross_reference_groups que originou esta sugestão (só quando origin='group-suggestion'). */
    @Prop({ type: Types.ObjectId, ref: 'CrossReferenceGroupModel' })
    sourceGroupId?: Types.ObjectId;
}

export const ProductCompatibilitySchema = SchemaFactory.createForClass(ProductCompatibilityModel);

// Compound index for fast lookup of a specific vehicle for a product
ProductCompatibilitySchema.index({ product: 1, vehicleId: 1 });
// Reverse lookup: dado um veículo, encontrar produtos compatíveis.
ProductCompatibilitySchema.index({ vehicleId: 1, product: 1 });
