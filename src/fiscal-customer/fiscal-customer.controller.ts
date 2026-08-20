import { Controller, Get, Put, Param, Query, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FiscalCustomerService, FiscalCustomerUpsertInput } from './services/fiscal-customer.service';

@ApiTags('FiscalCustomer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('fiscal-customers')
export class FiscalCustomerController {
    constructor(private readonly fiscalCustomerService: FiscalCustomerService) { }

    @Get()
    @ApiOperation({ summary: 'Buscar clientes fiscais por documento ou nome' })
    async list(@Query('q') q?: string) {
        return await this.fiscalCustomerService.list(q);
    }

    @Get(':document')
    @ApiOperation({ summary: 'Consultar cliente fiscal por documento' })
    async findOne(@Param('document') document: string) {
        const customer = await this.fiscalCustomerService.findByDocument(document);
        if (!customer) throw new NotFoundException('Cliente fiscal não encontrado.');
        return customer;
    }

    @Put(':document')
    @ApiOperation({ summary: 'Editar manualmente um cadastro fiscal existente' })
    async update(@Param('document') document: string, @Body() body: Partial<FiscalCustomerUpsertInput>) {
        const customer = await this.fiscalCustomerService.update(document, body);
        if (!customer) throw new NotFoundException('Cliente fiscal não encontrado.');
        return customer;
    }
}
