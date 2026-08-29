import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';
import { StoreOwnerLookupPort } from './ports/store-owner-lookup.port';

@Injectable()
export class StoreOwnerLookupService implements StoreOwnerLookupPort {
    private readonly logger = new Logger(StoreOwnerLookupService.name);

    constructor(
        @InjectModel(StoreListingModel.name)
        private readonly storeListingModel: Model<StoreListingDocument>,
    ) { }

    /**
     * Resolve "a loja dona" via a StoreListing mais antiga do produto — hoje um produto tem no
     * máximo uma StoreListing, então isso é inequívoco. Se isso deixar de ser verdade (produto
     * vendido por múltiplas lojas), essa resolução passaria a escolher uma loja arbitrariamente
     * (a mais antiga) em vez de sinalizar a ambiguidade — loga um warning nesse caso para que o
     * cenário seja detectável em produção antes de virar um bug silencioso real.
     */
    async findStoreIdByProduct(productId: string): Promise<string | null> {
        const [doc, count] = await Promise.all([
            this.storeListingModel.findOne({ productId }).sort({ _id: 1 }).exec(),
            this.storeListingModel.countDocuments({ productId }),
        ]);
        if (count > 1) {
            this.logger.warn(
                `[StoreOwnerLookup] produto ${productId} tem ${count} StoreListings — resolvendo pela mais antiga, ambiguidade real não suportada ainda.`,
            );
        }
        return doc ? doc.storeId.toString() : null;
    }
}
