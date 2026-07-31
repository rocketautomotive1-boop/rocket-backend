import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { ProductShortTitleModel, ProductShortTitleDocument } from '../schemas/product-short-title.schema';

function normalize(text: string): string {
    return text.trim().toLowerCase();
}

/**
 * Migração one-off do antigo Product.displayName (string solta) para
 * ProductShortTitle (título curto reutilizável) — ver
 * docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md.
 *
 * `subtitle` NÃO é derivado automaticamente: não há como separar "Parafuso"
 * de "Dianteiro do Virabrequim" a partir de uma string livre já salva —
 * fica em branco, para o vendedor completar depois na tela de Categoria
 * (mesmo princípio de "backfill imperfeito" do design anterior de
 * displayName+category-hint).
 *
 * `dryRun: true` só conta o que seria criado/vinculado, sem escrever nada.
 */
@Injectable()
export class ProductShortTitleMigrationService {
    private readonly logger = new Logger(ProductShortTitleMigrationService.name);

    constructor(
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
        @InjectModel(ProductShortTitleModel.name)
        private readonly shortTitleModel: Model<ProductShortTitleDocument>,
    ) { }

    async migrateDisplayNameToShortTitle(options: { dryRun?: boolean } = {}) {
        const dryRun = !!options.dryRun;
        this.logger.log(`Starting displayName -> ProductShortTitle migration (dryRun=${dryRun})...`);

        // displayName foi removido do schema — lê o campo legado direto do driver
        // (bypassa a projeção do Mongoose, que não conhece mais o campo).
        const cursor = this.productModel
            .find({ displayName: { $exists: true, $ne: null } } as any)
            .select({ _id: 1, displayName: 1, titleId: 1 } as any)
            .lean()
            .cursor();

        let productsScanned = 0;
        let titlesCreated = 0;
        let productsLinked = 0;
        let productsSkipped = 0;

        for await (const doc of cursor) {
            productsScanned++;
            const raw = String((doc as any).displayName || '').trim();
            const alreadyLinked = !!(doc as any).titleId;

            if (!raw) {
                productsSkipped++;
                continue;
            }

            // Já vinculado (execução anterior parcial) — só falta limpar o campo legado,
            // não relinkar nem incrementar usageCount de novo.
            if (alreadyLinked) {
                productsSkipped++;
                if (!dryRun) {
                    // strict:false necessário — displayName não existe mais no schema, e o
                    // Mongoose descarta silenciosamente $unset de paths desconhecidos em modo
                    // strict (default), reportando modifiedCount:1 sem aplicar a operação.
                    await this.productModel
                        .updateOne({ _id: doc._id }, { $unset: { displayName: '' } }, { strict: false })
                        .exec();
                }
                continue;
            }

            const textNormalized = normalize(raw);
            let title = await this.shortTitleModel.findOne({ textNormalized }).exec();

            if (!title) {
                titlesCreated++;
                if (!dryRun) {
                    title = await this.shortTitleModel.create({
                        text: raw,
                        textNormalized,
                        synonyms: [],
                        usageCount: 0,
                    });
                }
            }

            productsLinked++;
            if (!dryRun && title) {
                // strict:false necessário — ver comentário acima sobre $unset de displayName.
                await this.productModel
                    .updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                titleId: new Types.ObjectId(String(title._id)),
                                titleText: title.text,
                                titleSynonyms: title.synonyms,
                            },
                            $unset: { displayName: '' },
                        },
                        { strict: false },
                    )
                    .exec();
                await this.shortTitleModel.updateOne({ _id: title._id }, { $inc: { usageCount: 1 } }).exec();
            }
        }

        this.logger.log(
            `Migration finished. Products scanned: ${productsScanned}. Titles created: ${titlesCreated}. ` +
            `Products linked: ${productsLinked}. Skipped (no displayName or already linked): ${productsSkipped}.`,
        );

        return { productsScanned, titlesCreated, productsLinked, productsSkipped, dryRun };
    }
}
