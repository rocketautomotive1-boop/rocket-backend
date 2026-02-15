import { Controller, Post, Get, Body, Param, InternalServerErrorException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FiscalService } from './services/fiscal.service';

@ApiTags('Fiscal')
@Controller('fiscal')
export class FiscalController {
    constructor(private readonly fiscalService: FiscalService) { }

    @Get('nfe/prepare/:orderId')
    @ApiOperation({ summary: 'Preparar dados da NFe para conferência' })
    async prepareNFe(@Param('orderId') orderId: string) {
        return await this.fiscalService.prepareNFeData(orderId);
    }

    @Post('nfe/emit/:orderId')
    @ApiOperation({ summary: 'Emitir NFe para um pedido (com dados confirmados)' })
    async emitNFe(@Param('orderId') orderId: string, @Body() orderData: any) {
        // orderData must be the confirmed structure from prepareNFe
        try {
            return await this.fiscalService.emitNFe(orderId, orderData);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Get('nfe/:orderId')
    @ApiOperation({ summary: 'Consultar NFe de um pedido' })
    async getNFe(@Param('orderId') orderId: string) {
        return await this.fiscalService.getNFeByOrderId(orderId);
    }

    @Post('config/issuer')
    @ApiOperation({ summary: 'Salvar configurações do emitente' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                data: { type: 'string', description: 'JSON stringified issuer data' },
                certificate: { type: 'string', format: 'binary' },
            },
        },
    })
    @UseInterceptors(FileInterceptor('certificate'))
    async saveIssuer(@Body() body: any, @UploadedFile() file: any) {
        let rawData = body.data ? JSON.parse(body.data) : body;

        // Map flat address fields to address object
        const { street, number, neighborhood, city, state, zipCode, ibgeCode, certPassword, ...rest } = rawData;
        const data = {
            ...rest,
            certificatePassword: certPassword || rest.certificatePassword, // Map certPassword to certificatePassword
            address: {
                street,
                number,
                neighborhood,
                city,
                state,
                zipCode,
                ibgeCode
            }
        };

        if (file) {
            data.certificatePfx = file.buffer.toString('base64');
        }

        return await this.fiscalService.saveIssuer(data);
    }

    @Get('config/issuer')
    @ApiOperation({ summary: 'Obter configurações do emitente' })
    async getIssuer() {
        return await this.fiscalService.getIssuer();
    }
}
