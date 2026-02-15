
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CrossReferenceGroupModel, CrossReferenceGroupDocument } from '../schemas/cross-reference-group.schema';

@Injectable()
export class CatalogMigrationService {
    private readonly logger = new Logger(CatalogMigrationService.name);

    constructor(
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
        @InjectModel(CrossReferenceGroupModel.name)
        private readonly groupModel: Model<CrossReferenceGroupDocument>
    ) { }

    async migrateOemCodes() {
        this.logger.log('Starting OEM Codes migration...');

        // Find all products with a crossReferenceGroupId
        const cursor = this.productModel.find({
            crossReferenceGroupId: { $exists: true, $ne: null }
        }).cursor();

        let count = 0;
        let updated = 0;

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            count++;
            try {
                const group = await this.groupModel.findById(doc.crossReferenceGroupId);
                if (group) {
                    const allCodes = group.codes.map(c => c.partNumber);

                    // Only update if different
                    const currentCodes = doc.oemCodes || [];
                    const isSame = allCodes.length === currentCodes.length &&
                        allCodes.sort().every((val, index) => val === currentCodes.sort()[index]);

                    if (!isSame) {
                        doc.oemCodes = allCodes;
                        await doc.save();
                        updated++;
                        if (updated % 100 === 0) {
                            this.logger.log(`Updated ${updated} products so far...`);
                        }
                    }
                }
            } catch (error) {
                this.logger.error(`Failed to migrate product ${doc._id}: ${error.message}`);
            }
        }

        this.logger.log(`Migration finished. Scanned: ${count}. Updated: ${updated}.`);
        return { scanned: count, updated };
    }
}
