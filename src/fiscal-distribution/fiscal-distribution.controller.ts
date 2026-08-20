import { Controller, Get, Post, Param, Query, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FiscalDistributionService } from './services/fiscal-distribution.service';
import { ManifestationType } from './services/nfe-manifestacao.client';

const VALID_TYPES: ManifestationType[] = ['CONFIRMATION', 'ACKNOWLEDGMENT', 'UNKNOWN', 'NOT_REALIZED'];

@ApiTags('FiscalDistribution')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('fiscal/distribution')
export class FiscalDistributionController {
    constructor(private readonly fiscalDistributionService: FiscalDistributionService) { }

    @Get()
    @ApiOperation({ summary: 'Listar NFe recebidas via Distribuição DFe' })
    async list(@Query('status') status?: string) {
        return await this.fiscalDistributionService.list(status);
    }

    @Post(':id/manifest')
    @ApiOperation({ summary: 'Manifestar uma NFe recebida (Confirmação/Ciência/Desconhecimento/Não Realizada)' })
    async manifest(@Param('id') id: string, @Body() body: { type: ManifestationType; justification?: string }) {
        if (!VALID_TYPES.includes(body?.type)) {
            throw new BadRequestException(`type deve ser um de: ${VALID_TYPES.join(', ')}`);
        }
        return await this.fiscalDistributionService.manifest(id, body.type, body.justification);
    }

    @Post(':id/import')
    @ApiOperation({ summary: 'Baixar XML completo e importar para conferência (fiscal_entries)' })
    async importXml(@Param('id') id: string) {
        return await this.fiscalDistributionService.importXml(id);
    }
}
