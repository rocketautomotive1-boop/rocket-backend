import { Controller, Get, Post, Delete, Body, Param, NotFoundException, BadRequestException } from '@nestjs/common';
import { CrossReferenceService } from '../services/cross-reference.service';
import { ProductService } from '../product.service';

// Kit ↔ component relations (a complete assembly, e.g. a full alternator,
// and the different products that are its separately-sellable parts). See
// docs/superpowers/specs/2026-07-24-kit-component-relations-design.md.
// Reuses the same cross_reference_groups/codes storage as OEM equivalence
// (CrossReferenceController), discriminated by groupType:'kit' — kept as a
// separate controller/route since the two are conceptually distinct
// relations for the storefront/admin consumer.
@Controller('products/:id/kit-relations')
export class KitRelationsController {
    constructor(
        private readonly crossReferenceService: CrossReferenceService,
        private readonly productService: ProductService,
    ) { }

    @Get()
    async getKitRelations(@Param('id') id: string) {
        const product = await this.productService.findOneBySlugOrId(id);
        if (!product) throw new NotFoundException('Product not found');

        return this.crossReferenceService.getKitRelations(String((product as any)._id ?? (product as any).id));
    }

    @Post()
    async setKitComponents(
        @Param('id') id: string,
        @Body() body: { componentProductIds: string[] },
    ) {
        if (!Array.isArray(body?.componentProductIds) || body.componentProductIds.length === 0) {
            throw new BadRequestException('componentProductIds is required');
        }

        const product = await this.productService.findOneBySlugOrId(id);
        if (!product) throw new NotFoundException('Product not found');

        const group = await this.crossReferenceService.setKitComponents(
            String((product as any)._id ?? (product as any).id),
            body.componentProductIds,
        );
        return { message: 'Kit components updated', groupId: group?._id };
    }

    @Delete(':groupId/components/:codeId')
    async removeKitComponent(@Param('groupId') groupId: string, @Param('codeId') codeId: string) {
        await this.crossReferenceService.removeKitComponent(groupId, codeId);
        return { message: 'Component removed' };
    }

    @Delete(':groupId')
    async removeKitGroup(@Param('groupId') groupId: string) {
        await this.crossReferenceService.removeKitGroup(groupId);
        return { message: 'Kit group removed' };
    }
}
