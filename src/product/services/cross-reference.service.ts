import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CrossReferenceGroupModel, CrossReferenceGroupDocument } from '../schemas/cross-reference-group.schema';
import { ProductService } from '../product.service';
import { ProductModel, ProductDocument } from '../schemas/product.schema';

@Injectable()
export class CrossReferenceService {
    private readonly logger = new Logger(CrossReferenceService.name);

    constructor(
        @InjectModel(CrossReferenceGroupModel.name)
        private readonly groupModel: Model<CrossReferenceGroupDocument>,
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>, // Injected directly for bulk updates
        @Inject(forwardRef(() => ProductService))
        private readonly productService: ProductService,
    ) { }

    async findGroupById(id: string): Promise<CrossReferenceGroupDocument> {
        return this.groupModel.findById(id);
    }

    async findGroupByCode(partNumber: string): Promise<CrossReferenceGroupDocument> {
        // Case insensitive search might be needed, but strictly partNumbers are usually standardized or we use regex
        return this.groupModel.findOne({ 'codes.partNumber': partNumber });
    }

    async createGroup(codes: { brand: string, partNumber: string }[]): Promise<CrossReferenceGroupDocument> {
        const group = new this.groupModel({ codes });
        return group.save();
    }

    async addCodeToGroup(groupId: string, code: { brand: string; partNumber: string }): Promise<CrossReferenceGroupDocument> {
        const group = await this.groupModel.findById(groupId);
        if (!group) throw new Error('Group not found');

        // Check availability
        const exists = group.codes.some(c => c.partNumber === code.partNumber && c.brand === code.brand);
        if (!exists) {
            group.codes.push(code);
            await group.save();
            await this.handleGroupUpdate(group);
        }
        return group;
    }

    async linkProductToGroup(productId: string, groupId: string) {
        const product = await this.productService.findDocument(productId);
        if (!product) throw new Error('Product not found');
        const group = await this.groupModel.findById(groupId);

        product.crossReferenceGroupId = new Types.ObjectId(groupId);
        // Sync OEM Codes immediately
        if (group) {
            product.oemCodes = group.codes.map(c => c.partNumber);
        }
        await (product as any).save();
    }

    /**
     * Main logic: Given a product and a list of equivalent codes, enforce the structure.
     * This handles scenarios A and B from the plan.
     */
    async processCrossReferences(productId: string, references: { brand: string; partNumber: string }[]) {
        const product = await this.productService.findDocument(productId);

        let groupId = product.crossReferenceGroupId;
        let group: CrossReferenceGroupDocument;

        if (groupId) {
            group = await this.groupModel.findById(groupId);
        }

        // If no group exists yet, check if any of the new references belong to an existing group
        if (!group) {
            for (const ref of references) {
                const existingGroup = await this.findGroupByCode(ref.partNumber);
                if (existingGroup) {
                    group = existingGroup;
                    break;
                }
            }
        }

        // Still no group? Create one.
        if (!group) {
            // Initial codes include the product itself + references
            const initialCodes = [
                { brand: product.brand?.name || 'GENERIC', partNumber: product.partNumber },
                ...references
            ];
            group = await this.createGroup(initialCodes);
        } else {
            // Add missing codes to existing group
            let changed = false;

            // Ensure product itself is in code list
            const selfExists = group.codes.some(c => c.partNumber === product.partNumber);
            if (!selfExists) {
                group.codes.push({ brand: product.brand?.name || 'GENERIC', partNumber: product.partNumber });
                changed = true;
            }

            for (const ref of references) {
                const exists = group.codes.some(c => c.partNumber === ref.partNumber);
                if (!exists) {
                    group.codes.push(ref);
                    changed = true;
                }
            }
            if (changed) {
                await group.save();
                await this.handleGroupUpdate(group);
            }
        }

        // Ensure Link
        if (String(product.crossReferenceGroupId) !== String(group._id)) {
            await this.linkProductToGroup(productId, String(group._id));
        }

        return group;
    }

    /**
     * When a group changes, we might need to re-index ALL products in that group
     * because they all share the referenced codes in ES.
     */
    private async handleGroupUpdate(group: CrossReferenceGroupDocument) {
        const allCodes = group.codes.map(c => c.partNumber);

        // Bulk Update Mongo
        await this.productModel.updateMany(
            { crossReferenceGroupId: group._id },
            { $set: { oemCodes: allCodes } }
        );
    }
}
