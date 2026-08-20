import { Controller, Post, Get, Body, Param, Res, HttpCode, HttpStatus, InternalServerErrorException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FiscalService } from './services/fiscal.service';
import { FiscalIssuanceRequestService } from './services/fiscal-issuance-request.service';

@ApiTags('Fiscal')
@Controller('fiscal')
export class FiscalController {
    constructor(
        private readonly fiscalService: FiscalService,
        private readonly issuanceRequest: FiscalIssuanceRequestService,
    ) { }

    @Get('nfe/prepare/:orderId')
    @ApiOperation({ summary: 'Preparar dados da NFe para conferência' })
    async prepareNFe(@Param('orderId') orderId: string) {
        return await this.fiscalService.prepareNFeData(orderId);
    }

    @Post('nfe/emit/:orderId')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Enfileirar emissão de NFe para um pedido (assíncrono — consulte GET /fiscal/nfe/:orderId para o resultado)' })
    async emitNFe(@Param('orderId') orderId: string, @Body() orderData: any) {
        // orderData must be the confirmed structure from prepareNFe
        try {
            return await this.issuanceRequest.request(orderId, orderData);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Post('nfe/avulsa')
    @ApiOperation({ summary: 'Emitir NFe avulsa (sem pedido vinculado) — uso para testes/homologação' })
    async emitNFeAvulsa(@Body() orderData: any) {
        try {
            return await this.fiscalService.emitNFeAvulsa(orderData);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Get('nfe/:orderId')
    @ApiOperation({ summary: 'Consultar NFe principal de um pedido (AUTHORIZED > ERROR > DRAFT > CANCELLED)' })
    async getNFe(@Param('orderId') orderId: string) {
        return await this.fiscalService.getNFeByOrderId(orderId);
    }

    @Get('nfe/:orderId/xml')
    @ApiOperation({ summary: 'Baixar o XML oficial (assinado) da NFe mais relevante do pedido' })
    async downloadXml(@Param('orderId') orderId: string, @Res() res: Response) {
        const result = await this.fiscalService.getNFeXml(orderId);
        if (!result) throw new NotFoundException(`XML da NFe para o pedido ${orderId} não encontrado.`);
        res.set({
            'Content-Type': 'application/xml',
            'Content-Disposition': `attachment; filename="NFe${result.accessKey}.xml"`,
        });
        res.send(result.xml);
    }

    @Get('nfe/:orderId/all')
    @ApiOperation({ summary: 'Listar todas as NFes de um pedido (mais recente primeiro, sem XML)' })
    async listNFes(@Param('orderId') orderId: string) {
        return await this.fiscalService.listNFesByOrderId(orderId);
    }

    @Post('nfe/:orderId/cancel')
    @ApiOperation({ summary: 'Cancelar NFe autorizada de um pedido' })
    async cancelNFe(@Param('orderId') orderId: string, @Body() body: { justification: string }) {
        if (!body?.justification) {
            throw new BadRequestException('Justificativa de cancelamento é obrigatória.');
        }
        try {
            return await this.fiscalService.cancelNFe(orderId, body.justification);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Post('nfe/:orderId/cce')
    @ApiOperation({ summary: 'Emitir Carta de Correção Eletrônica (CC-e) para uma NFe autorizada' })
    async correctNFe(@Param('orderId') orderId: string, @Body() body: { text: string }) {
        if (!body?.text) {
            throw new BadRequestException('Texto de correção é obrigatório.');
        }
        try {
            return await this.fiscalService.correctNFe(orderId, body.text);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Post('nfe/inutilizar')
    @ApiOperation({ summary: 'Inutilizar faixa de numeração de NFe nunca emitida' })
    async inutilizeRange(@Body() body: { storeId: string; series: number; from: number; to: number; justification: string; environment?: string }) {
        if (!body?.storeId || !body.series || !body.from || !body.to || !body.justification) {
            throw new BadRequestException('storeId, series, from, to e justification são obrigatórios.');
        }
        try {
            return await this.fiscalService.inutilizeRange(body);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    // Configuração da entidade legal emissora (CNPJ/certificado) migrou para
    // LegalEntityController (/legal-entities/active). Configuração de série/sellerId
    // por canal de venda migrou para StoreController (/stores/:id/fiscal-channels/...).
}
