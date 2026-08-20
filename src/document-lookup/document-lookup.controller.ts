import { Controller, Get, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DocumentLookupService } from './services/document-lookup.service';

@ApiTags('DocumentLookup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('document-lookup')
export class DocumentLookupController {
    constructor(private readonly documentLookupService: DocumentLookupService) { }

    @Get('cnpj/:cnpj')
    @ApiOperation({ summary: 'Consultar dados de CNPJ (BrasilAPI, gratuito)' })
    async lookupCnpj(@Param('cnpj') cnpj: string) {
        const digits = cnpj.replace(/\D/g, '');
        if (digits.length !== 14) throw new BadRequestException('CNPJ inválido.');
        return await this.documentLookupService.lookupCnpj(digits);
    }

    @Get('cpf/:cpf')
    @ApiOperation({ summary: 'Consultar dados de CPF (provedor a configurar)' })
    async lookupCpf(@Param('cpf') cpf: string, @Query('birthDate') birthDate: string | undefined, @Req() req: any) {
        const digits = cpf.replace(/\D/g, '');
        if (digits.length !== 11) throw new BadRequestException('CPF inválido.');
        const lookedUpBy = req.user?.id || req.user?.email;
        return await this.documentLookupService.lookupCpf(digits, birthDate, lookedUpBy);
    }
}
