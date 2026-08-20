import { Controller, Post, Get, Body, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { LegalEntityService } from './services/legal-entity.service';
import { CertificateInspectionService } from './services/certificate-inspection.service';

@ApiTags('LegalEntity')
@Controller('legal-entities')
export class LegalEntityController {
    constructor(
        private readonly legalEntityService: LegalEntityService,
        private readonly certificateInspectionService: CertificateInspectionService,
    ) { }

    @Post('inspect-certificate')
    @ApiOperation({ summary: 'Extrair CNPJ/razão social/IE/regime do certificado + consultas SEFAZ gratuitas (não persiste)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                password: { type: 'string' },
                uf: { type: 'string' },
                certificate: { type: 'string', format: 'binary' },
            },
        },
    })
    @UseInterceptors(FileInterceptor('certificate'))
    async inspectCertificate(@Body() body: any, @UploadedFile() file: any) {
        if (!file) throw new BadRequestException('Arquivo do certificado (.pfx) é obrigatório.');
        const pfxBase64 = file.buffer.toString('base64');
        const uf = (body.uf || 'PE').toUpperCase();
        return await this.certificateInspectionService.inspect(pfxBase64, body.password, uf);
    }

    @Post('active')
    @ApiOperation({ summary: 'Salvar configurações da entidade legal emissora' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                data: { type: 'string', description: 'JSON stringified legal entity data' },
                certificate: { type: 'string', format: 'binary' },
            },
        },
    })
    @UseInterceptors(FileInterceptor('certificate'))
    async saveActive(@Body() body: any, @UploadedFile() file: any) {
        let rawData = body.data ? JSON.parse(body.data) : body;

        const { street, number, neighborhood, city, state, zipCode, ibgeCode, certPassword, ...rest } = rawData;
        const data: any = {
            ...rest,
            certificatePassword: certPassword || rest.certificatePassword,
            address: {
                street,
                number,
                neighborhood,
                city,
                state,
                zipCode,
                ibgeCode,
            },
        };

        if (file) {
            data.certificatePfx = file.buffer.toString('base64');
        }

        return await this.legalEntityService.saveActive(data);
    }

    @Get('active')
    @ApiOperation({ summary: 'Obter configurações da entidade legal emissora' })
    async getActive() {
        return await this.legalEntityService.findActive();
    }
}
