import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery
} from '@nestjs/swagger';
import { ProductAllocationService } from '../services/product-allocation.service';
import { CreateProductAllocationDto } from '../dto/create-product-allocation.dto';
import { UpdateProductAllocationDto } from '../dto/update-product-allocation.dto';
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AllocationDocument } from '../schemas/allocation.schema';

@ApiTags('Product Allocation')
@Controller('allocations')
//@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductAllocationController {
  constructor(private readonly allocationService: ProductAllocationService) { }

  @Get()
  @ApiOperation({ summary: 'Listar todas as alocações' })
  @ApiResponse({ status: 200, description: 'Lista de alocações retornada com sucesso' })
  async findAll(): Promise<AllocationDocument[]> {
    return this.allocationService.findAll();
  }

  @Get('available')
  @ApiOperation({ summary: 'Listar alocações disponíveis' })
  @ApiResponse({ status: 200, description: 'Lista de alocações disponíveis retornada com sucesso' })
  async findAvailable(): Promise<AllocationDocument[]> {
    return this.allocationService.findAvailable();
  }

  @Get('path/search')
  @ApiOperation({ summary: 'Buscar alocações por prefixo de caminho (ex: "F1/R2")' })
  @ApiResponse({ status: 200, description: 'Alocações encontradas com sucesso' })
  @ApiQuery({ name: 'prefix', description: 'O prefixo do Materialized Path' })
  async findByPath(@Query('prefix') prefix: string): Promise<AllocationDocument[]> {
    return this.allocationService.findByPath(prefix);
  }

  @Get('path/exact')
  @ApiOperation({ summary: 'Buscar alocação exata pelo caminho (ex: "F1/R2/A/S1/L1")' })
  @ApiResponse({ status: 200, description: 'Alocação encontrada com sucesso' })
  @ApiQuery({ name: 'path', description: 'O caminho materializado exato' })
  async findExactPath(@Query('path') path: string): Promise<AllocationDocument | null> {
    return this.allocationService.findExactPath(path);
  }

  @Get(':id/products')
  @ApiOperation({ summary: 'Buscar todos os produtos de todos os boxes da alocação' })
  @ApiResponse({ status: 200, description: 'Produtos retornados com sucesso agrupados por box' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async getAllocationProducts(@Param('id') id: string): Promise<any> {
    return this.allocationService.getAllocationProducts(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar alocação por ID' })
  @ApiResponse({ status: 200, description: 'Alocação encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async findOne(@Param('id') id: string): Promise<AllocationDocument> {
    return this.allocationService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar nova alocação' })
  @ApiResponse({ status: 201, description: 'Alocação criada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos ou alocação já existe' })
  async create(@Body() createAllocationDto: CreateProductAllocationDto): Promise<AllocationDocument> {
    return this.allocationService.create(createAllocationDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar alocação' })
  @ApiResponse({ status: 200, description: 'Alocação atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  @ApiResponse({ status: 400, description: 'Dados inválidos ou conflito de coordenadas' })
  async update(
    @Param('id') id: string,
    @Body() updateAllocationDto: UpdateProductAllocationDto,
  ): Promise<AllocationDocument> {
    return this.allocationService.update(id, updateAllocationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir alocação' })
  @ApiResponse({ status: 200, description: 'Alocação excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  @ApiResponse({ status: 400, description: 'Não é possível excluir alocação com inventários associados' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.allocationService.remove(id);
    return { message: 'Alocação excluída com sucesso' };
  }

  @Put(':id/toggle-availability')
  @ApiOperation({ summary: 'Alternar disponibilidade da alocação' })
  @ApiResponse({ status: 200, description: 'Disponibilidade alterada com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async toggleAvailability(@Param('id') id: string): Promise<AllocationDocument> {
    return this.allocationService.toggleAvailability(id);
  }

  @Put(':id/toggle-active')
  @ApiOperation({ summary: 'Alternar status ativo da alocação' })
  @ApiResponse({ status: 200, description: 'Status ativo alterado com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async toggleActive(@Param('id') id: string): Promise<AllocationDocument> {
    return this.allocationService.toggleActive(id);
  }


  @Post('scan')
  @ApiOperation({ summary: 'Escanear QR Code de allocation e criar/buscar alocação' })
  @ApiResponse({ status: 200, description: 'Alocação criada/encontrada com sucesso' })
  @ApiQuery({ name: 'dryRun', description: 'Quando true, apenas pré-visualiza sem criar', required: false })
  async scanAllocation(
    @Body() body: { qr: string; warehouseId?: string },
    @Query('dryRun') dryRun?: string,
  ): Promise<any> {
    const isDryRun = typeof dryRun === 'string' ? dryRun === 'true' : false;
    return this.allocationService.scanAllocation(body.qr, body.warehouseId, isDryRun);
  }
}