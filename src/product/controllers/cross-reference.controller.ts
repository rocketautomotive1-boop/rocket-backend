import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import { CrossReferenceService } from '../services/cross-reference.service';
import { ProductService } from '../product.service';

@Controller('products/:id/cross-references')
export class CrossReferenceController {
    constructor(
        private readonly crossReferenceService: CrossReferenceService,
        private readonly productService: ProductService
    ) { }

    @Get()
    async getCrossReferences(@Param('id') id: string) {
        const product = await this.productService.findOne(id);
        if (!product) throw new NotFoundException('Product not found');

        if (!product.crossReferenceGroupId) {
            return {
                groupId: null,
                codes: []
            };
        }

        const group = await this.crossReferenceService.findGroupById(String(product.crossReferenceGroupId));
        return {
            groupId: group?._id,
            codes: group?.codes || []
        };
    }

    @Post()
    async addCrossReference(
        @Param('id') id: string,
        @Body() body: { brand: string; partNumber: string } | { brand: string; partNumber: string }[]
    ) {
        const refs = Array.isArray(body) ? body : [body];

        // Basic Validation
        if (refs.some(r => !r.brand || !r.partNumber)) {
            throw new Error('Brand and PartNumber are required for all references');
        }

        const group = await this.crossReferenceService.processCrossReferences(id, refs);
        return {
            message: 'Cross references updated',
            groupId: group._id,
            codes: group.codes
        };
    }
}
