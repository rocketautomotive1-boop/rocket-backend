import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductShortTitleService } from '../services/product-short-title.service';
import { TitleCategoryHintService } from '../services/title-category-hint.service';

// Admin curation surface (rocket-admin "Títulos curtos") — mesmo padrão sem guard
// dos demais controllers admin deste módulo (ver CrossReferenceConflictsController).
@ApiTags('Product Short Titles')
@Controller('product-short-titles')
export class ProductShortTitleController {
    constructor(
        private readonly shortTitleService: ProductShortTitleService,
        private readonly titleCategoryHintService: TitleCategoryHintService,
    ) { }

    @Get('autocomplete')
    @ApiOperation({ summary: 'Busca títulos curtos por texto ou sinônimo, ordenado por popularidade' })
    @ApiQuery({ name: 'q', required: true, type: String })
    async autocomplete(@Query('q') q: string) {
        return this.shortTitleService.autocomplete(q);
    }

    @Post(':id/synonyms')
    @ApiOperation({ summary: 'Adiciona um sinônimo a um título curto e propaga para os produtos vinculados' })
    async addSynonym(@Param('id') id: string, @Body('synonym') synonym: string) {
        return this.shortTitleService.addSynonym(id, synonym);
    }

    @Delete(':id/synonyms')
    @ApiOperation({ summary: 'Remove um sinônimo de um título curto e propaga para os produtos vinculados' })
    async removeSynonym(@Param('id') id: string, @Query('synonym') synonym: string) {
        return this.shortTitleService.removeSynonym(id, synonym);
    }

    @Post(':id/merge')
    @ApiOperation({ summary: 'Mescla este título (origem) em outro (destino): move produtos, soma usageCount, herda o texto como sinônimo, apaga a origem' })
    async merge(@Param('id') id: string, @Body('targetId') targetId: string) {
        return this.shortTitleService.merge(id, targetId);
    }

    @Get(':id/category-hints')
    @ApiOperation({ summary: 'Lista as categorias aprendidas (title_category_hints) para este título, ordenadas por uso' })
    async listCategoryHints(@Param('id') id: string) {
        return this.titleCategoryHintService.listHints(id);
    }

    @Delete(':id/category-hints/:categoryId')
    @ApiOperation({ summary: 'Remove um vínculo titleId->categoria aprendido incorretamente' })
    async removeCategoryHint(@Param('id') id: string, @Param('categoryId') categoryId: string) {
        await this.titleCategoryHintService.invalidateHint(id, categoryId);
        return { success: true };
    }
}
