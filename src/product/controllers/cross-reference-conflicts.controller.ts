import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CrossReferenceService } from '../services/cross-reference.service';

// Admin curation surface for cross-reference groups flagged with status:'conflict'
// by CrossReferenceService.processCrossReferences (a code claimed by two different
// groups). Deliberately separate from CrossReferenceController (which is scoped
// per-product) — conflicts are reviewed across products, not from one product's page.
@ApiTags('cross-references')
@Controller('cross-references')
export class CrossReferenceConflictsController {
    constructor(private readonly crossReferenceService: CrossReferenceService) { }

    @Get('conflicts')
    @ApiOperation({ summary: 'List cross-reference groups flagged for manual review (paginated), optionally filtered by brand/code search' })
    async listConflicts(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
        const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));

        const { results, total } = await this.crossReferenceService.listConflicts(pageNum, limitNum, search);
        return {
            items: results.map(({ group, codes, products }) => ({
                groupId: group._id,
                conflictReason: group.conflictReason,
                conflictAt: group.conflictAt,
                codes: codes.map((c: { _id: unknown; brand: string; raw: string }) => ({
                    codeId: c._id,
                    brand: c.brand,
                    partNumber: c.raw,
                })),
                products: (products ?? []).map((p: any) => ({
                    productId: p._id,
                    name: p.name,
                    slug: p.slug,
                    origemCatalogo: p.origemCatalogo,
                    partNumber: p.partNumber,
                    brand: p.brand?.name,
                })),
            })),
            total,
            page: pageNum,
            limit: limitNum,
        };
    }

    @Post(':groupId/resolve')
    @ApiOperation({ summary: 'Mark a flagged group as reviewed (false positive)' })
    async resolveConflict(@Param('groupId') groupId: string) {
        const group = await this.crossReferenceService.resolveConflict(groupId);
        return { groupId: group._id, status: group.status };
    }

    @Post('codes/:codeId/move')
    @ApiOperation({ summary: 'Move a code claimed by the wrong group to the correct group (resolves an index conflict)' })
    async moveCode(@Param('codeId') codeId: string, @Body() body: { targetGroupId: string }) {
        const code = await this.crossReferenceService.moveCode(codeId, body.targetGroupId);
        return { codeId: code._id, groupId: code.groupId, brand: code.brand, partNumber: code.raw };
    }

    @Post('codes/:codeId/edit')
    @ApiOperation({ summary: "Correct a code row's own brand and/or partNumber (catalog data was wrong), as opposed to moveCode which relocates an already-correct row" })
    async editCode(@Param('codeId') codeId: string, @Body() body: { brand?: string; partNumber?: string }) {
        const code = await this.crossReferenceService.editCode(codeId, { brand: body.brand, raw: body.partNumber });
        return { codeId: code._id, groupId: code.groupId, brand: code.brand, partNumber: code.raw };
    }

    @Post(':sourceGroupId/merge')
    @ApiOperation({ summary: 'Merge sourceGroupId into targetGroupId — both refer to the same physical part. Moves every code, drops duplicates, marks source active.' })
    async mergeGroups(@Param('sourceGroupId') sourceGroupId: string, @Body() body: { targetGroupId: string }) {
        return this.crossReferenceService.mergeGroups(sourceGroupId, body.targetGroupId);
    }

    @Post('codes/:codeId/discard')
    @ApiOperation({ summary: 'Discard a code row. Refuses a product\'s own self-reference unless force:true is passed (catalog data was wrong)' })
    async discardCode(@Param('codeId') codeId: string, @Body() body?: { force?: boolean }) {
        await this.crossReferenceService.discardCode(codeId, body?.force ?? false);
        return { codeId, discarded: true };
    }

    @Post('codes/discard-bulk')
    @ApiOperation({ summary: 'Discard multiple ghost-brand duplicate codes at once, given an explicit id list (admin select-all flow)' })
    async discardCodes(@Body() body: { codeIds: string[] }) {
        return this.crossReferenceService.discardCodes(body.codeIds ?? []);
    }

    @Get('ghost-brand-candidates')
    @ApiOperation({ summary: 'List ghost-brand duplicate codes flagged during migration, for manual discard review' })
    async listGhostBrandCandidates(@Query('page') page?: string, @Query('limit') limit?: string) {
        const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
        return this.crossReferenceService.listGhostBrandCandidates(pageNum, limitNum);
    }

    // Declared LAST among GET routes: ':groupId' is a catch-all path segment
    // and would shadow 'conflicts'/'ghost-brand-candidates' above if it came
    // first — Nest matches routes in declaration order per HTTP method.
    @Get(':groupId')
    @ApiOperation({ summary: 'Get a single cross-reference group and its member codes, for merge-target preview' })
    async getGroup(@Param('groupId') groupId: string) {
        const group = await this.crossReferenceService.findGroupById(groupId);
        if (!group) return null;
        const [codes, products] = await Promise.all([
            this.crossReferenceService.findCodesByGroupId(groupId),
            this.crossReferenceService.findProductsByGroupId(groupId),
        ]);
        return {
            groupId: group._id,
            status: group.status,
            conflictReason: group.conflictReason,
            codes: codes.map((c) => ({ codeId: c._id, brand: c.brand, partNumber: c.raw })),
            products: products.map((p: any) => ({
                productId: p._id,
                name: p.name,
                slug: p.slug,
                origemCatalogo: p.origemCatalogo,
                partNumber: p.partNumber,
                brand: p.brand?.name,
            })),
        };
    }

    @Post('products/:productId/move')
    @ApiOperation({ summary: "Move a product to a different cross-reference group by relocating its own self-reference code (resolves the product's own crossReferenceGroupId, not just a single code row)" })
    async moveProduct(@Param('productId') productId: string, @Body() body: { targetGroupId: string }) {
        const code = await this.crossReferenceService.moveProductToGroup(productId, body.targetGroupId);
        return { codeId: code._id, groupId: code.groupId, brand: code.brand, partNumber: code.raw };
    }
}
