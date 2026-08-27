import { Controller, Post, Put, Get, Param, Body, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { LegalEntityService } from './services/legal-entity.service';
import { CertificateInspectionService } from './services/certificate-inspection.service';
import { SignatureService } from '../fiscal/services/signature.service';

@ApiTags('LegalEntity')
@Controller('legal-entities')
export class LegalEntityController {
    constructor(
        private readonly legalEntityService: LegalEntityService,
        private readonly certificateInspectionService: CertificateInspectionService,
        private readonly signatureService: SignatureService,
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

    @Get()
    @ApiOperation({ summary: 'Listar entidades legais cadastradas' })
    async findAll() {
        return await this.legalEntityService.findAll();
    }

    @Get('active')
    @ApiOperation({ summary: '[Legado] Obter a única entidade legal ativa' })
    async getActive() {
        return await this.legalEntityService.findActive();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obter uma entidade legal por id' })
    async findOne(@Param('id') id: string) {
        return await this.legalEntityService.findById(id);
    }

    @Post()
    @ApiOperation({ summary: 'Criar uma nova entidade legal emissora' })
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
    async create(@Body() body: any, @UploadedFile() file: any) {
        const data = this.parseFormData(body, file);
        return await this.legalEntityService.create(data);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Atualizar uma entidade legal emissora existente' })
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
    async update(@Param('id') id: string, @Body() body: any, @UploadedFile() file: any) {
        const data = this.parseFormData(body, file);
        return await this.legalEntityService.update(id, data);
    }

    private parseFormData(body: any, file: any): any {
        const rawData = body.data ? JSON.parse(body.data) : body;

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
            // Sem isso, certificateValidUntil nunca era persistido no create/update
            // (só o endpoint de preview /inspect-certificate extraía, sem salvar) —
            // certificate-expiry-check.worker.ts nunca tinha o que checar, e uma
            // eventual expiração passava despercebida até falhar na emissão real.
            try {
                const extracted = this.signatureService.extractCertificateData(data.certificatePfx, data.certificatePassword);
                data.certificateValidUntil = extracted.validUntil;
            } catch {
                // Certificado inválido/senha errada — deixa a validação de negócio
                // (assinatura na emissão) reportar o erro real; não bloqueia o cadastro aqui.
            }
        }

        return data;
    }
}
