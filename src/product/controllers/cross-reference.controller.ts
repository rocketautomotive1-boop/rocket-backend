import { Controller, Get, Post, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { CrossReferenceService } from '../services/cross-reference.service';
import { ProductService } from '../product.service';
import { normalizeBrand, normalizeCode } from '../utils/code-key.util';

@Controller('products/:id/cross-references')
export class CrossReferenceController {
    constructor(
        private readonly crossReferenceService: CrossReferenceService,
        private readonly productService: ProductService
    ) { }

    @Get()
    async getCrossReferences(@Param('id') id: string) {
        const product = await this.productService.findOneBySlugOrId(id);
        if (!product) throw new NotFoundException('Product not found');

        if (!product.crossReferenceGroupId) {
            return {
                groupId: null,
                codes: []
            };
        }

        const group = await this.crossReferenceService.findGroupById(String(product.crossReferenceGroupId));
        const allCodes = group ? await this.crossReferenceService.findCodesByGroupId(String(group._id)) : [];

        // The product's own code is a self-reference, not a cross-reference to show.
        const ownBrandKey = normalizeBrand(product.brand?.name || 'GENERIC');
        const ownCodeKey = normalizeCode(product.partNumber);
        const codes = allCodes.filter((c) => !(c.brandKey === ownBrandKey && c.codeKey === ownCodeKey));

        const linkedProducts = await this.crossReferenceService.findLinkedProductsByCodes(
            codes.map((c) => ({ brandKey: c.brandKey, codeKey: c.codeKey })),
        );

        return {
            groupId: group?._id,
            status: group?.status,
            conflictReason: group?.conflictReason,
            codes: codes.map((c) => ({
                codeId: c._id,
                brand: c.brand,
                partNumber: c.raw,
                linkedProduct: linkedProducts.get(`${c.brandKey}::${c.codeKey}`) ?? null,
            })),
        };
    }

    // Search is global (not scoped to this product's own group) — nested
    // under /products/:id/cross-references purely so the frontend calls it
    // relative to the product page it's used from, same as every other
    // route here. Declared before the catch-all-looking routes below only
    // matters for GET vs POST disambiguation, which Nest already handles
    // per-method, so no ordering hazard here (unlike the admin conflicts
    // controller's ':groupId' catch-all).
    @Get('search')
    async searchCrossReferences(@Query('q') q?: string) {
        const results = await this.crossReferenceService.searchCodes(q ?? '');
        return { results };
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
        const codes = await this.crossReferenceService.findCodesByGroupId(String(group._id));
        return {
            message: 'Cross references updated',
            groupId: group._id,
            status: group.status,
            codes: codes.map((c) => ({ brand: c.brand, partNumber: c.raw })),
        };
    }

    // Edit/remove reuse the SAME CrossReferenceService methods the admin
    // conflicts queue (cross-reference-conflicts.controller.ts) uses — the
    // guards there (editCode rejects an exact duplicate pair, discardCode
    // refuses to remove a product's own self-reference row) apply here too,
    // since a code row's correctness doesn't depend on which page it's
    // edited from.
    @Post('codes/:codeId/edit')
    async editCrossReference(
        @Param('codeId') codeId: string,
        @Body() body: { brand?: string; partNumber?: string },
    ) {
        const code = await this.crossReferenceService.editCode(codeId, { brand: body.brand, raw: body.partNumber });
        return { codeId: code._id, brand: code.brand, partNumber: code.raw };
    }

    @Post('codes/:codeId/discard')
    async discardCrossReference(@Param('codeId') codeId: string, @Body() body?: { force?: boolean }) {
        await this.crossReferenceService.discardCode(codeId, body?.force ?? false);
        return { codeId, discarded: true };
    }

    // Manual "these are the same part" call from the product page — merges
    // one or more groups found via search into this product's own group.
    // See mergeGroupsIntoProduct's comment for why this exists separately
    // from the freehand-copy POST above (that one hits an unavoidable wall
    // when a selected code already belongs to another group; this is the
    // fix for exactly that case).
    @Post('merge-groups')
    async mergeGroupsIntoProduct(@Param('id') id: string, @Body() body: { groupIds: string[] }) {
        const product = await this.productService.findOneBySlugOrId(id);
        if (!product) throw new NotFoundException('Product not found');

        return this.crossReferenceService.mergeGroupsIntoProduct(String(product._id), body.groupIds ?? []);
    }
}
