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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProductAllocation } from '../product-types';

@ApiTags('Product Allocation')
@Controller('allocations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductAllocationController {
  constructor(private readonly allocationService: ProductAllocationService) { }

  @Get()
  @ApiOperation({ summary: 'Listar todas as alocações' })
  @ApiResponse({ status: 200, description: 'Lista de alocações retornada com sucesso' })
  async findAll(): Promise<ProductAllocation[]> {
    return this.allocationService.findAll();
  }

  @Get('available')
  @ApiOperation({ summary: 'Listar alocações disponíveis' })
  @ApiResponse({ status: 200, description: 'Lista de alocações disponíveis retornada com sucesso' })
  async findAvailable(): Promise<ProductAllocation[]> {
    return this.allocationService.findAvailable();
  }

  @Get('area/:area')
  @ApiOperation({ summary: 'Buscar alocações por área' })
  @ApiResponse({ status: 200, description: 'Alocações da área retornadas com sucesso' })
  async findByArea(@Param('area') area: string): Promise<ProductAllocation[]> {
    return this.allocationService.findByArea(area);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar alocação por ID' })
  @ApiResponse({ status: 200, description: 'Alocação encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async findOne(@Param('id') id: number): Promise<ProductAllocation> {
    return this.allocationService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar nova alocação' })
  @ApiResponse({ status: 201, description: 'Alocação criada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos ou alocação já existe' })
  async create(@Body() createAllocationDto: CreateProductAllocationDto): Promise<ProductAllocation> {
    return this.allocationService.create(createAllocationDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar alocação' })
  @ApiResponse({ status: 200, description: 'Alocação atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  @ApiResponse({ status: 400, description: 'Dados inválidos ou conflito de coordenadas' })
  async update(
    @Param('id') id: number,
    @Body() updateAllocationDto: UpdateProductAllocationDto,
  ): Promise<ProductAllocation> {
    return this.allocationService.update(id, updateAllocationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir alocação' })
  @ApiResponse({ status: 200, description: 'Alocação excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  @ApiResponse({ status: 400, description: 'Não é possível excluir alocação com inventários associados' })
  async remove(@Param('id') id: number): Promise<{ message: string }> {
    await this.allocationService.remove(id);
    return { message: 'Alocação excluída com sucesso' };
  }

  @Put(':id/toggle-availability')
  @ApiOperation({ summary: 'Alternar disponibilidade da alocação' })
  @ApiResponse({ status: 200, description: 'Disponibilidade alterada com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async toggleAvailability(@Param('id') id: number): Promise<ProductAllocation> {
    return this.allocationService.toggleAvailability(id);
  }

  @Put(':id/toggle-active')
  @ApiOperation({ summary: 'Alternar status ativo da alocação' })
  @ApiResponse({ status: 200, description: 'Status ativo alterado com sucesso' })
  @ApiResponse({ status: 404, description: 'Alocação não encontrada' })
  async toggleActive(@Param('id') id: number): Promise<ProductAllocation> {
    return this.allocationService.toggleActive(id);
  }

  @Get('coordinates/search')
  @ApiOperation({ summary: 'Buscar alocação por coordenadas específicas' })
  @ApiResponse({ status: 200, description: 'Alocação encontrada ou null' })
  @ApiQuery({ name: 'area', description: 'Área da alocação' })
  @ApiQuery({ name: 'column', description: 'Coluna da alocação' })
  @ApiQuery({ name: 'aisle', description: 'Corredor da alocação' })
  @ApiQuery({ name: 'rack', description: 'Prateleira da alocação' })
  @ApiQuery({ name: 'shelf', description: 'Prateleira da alocação' })
  @ApiQuery({ name: 'bin', description: 'Caixa da alocação' })
  @ApiQuery({ name: 'position', description: 'Posição da alocação' })
  async findByCoordinates(
    @Query('area') area: string,
    @Query('column') column: string,
    @Query('aisle') aisle: number,
    @Query('rack') rack: string,
    @Query('shelf') shelf: number,
    @Query('bin') bin: number,
    @Query('position') position: number,
  ): Promise<ProductAllocation | null> {
    return this.allocationService.findByCoordinates(area, column, aisle, rack, shelf, bin, position);
  }

  @Get('coordinates/search-new')
  @ApiOperation({ summary: 'Buscar alocação por novas coordenadas (floor/room/row/shelf/level/bin)' })
  @ApiResponse({ status: 200, description: 'Alocação encontrada ou null' })
  @ApiQuery({ name: 'floor', description: 'Andar (floor)' })
  @ApiQuery({ name: 'room', description: 'Sala (room)' })
  @ApiQuery({ name: 'row', description: 'Fileira (row)' })
  @ApiQuery({ name: 'shelf', description: 'Prateleira (shelf)' })
  @ApiQuery({ name: 'level', description: 'Nível da prateleira (level)' })
  @ApiQuery({ name: 'bin', description: 'Caixa/BIN' })
  async findByNewCoordinates(
    @Query('floor') floor: number,
    @Query('room') room: number,
    @Query('row') row: string,
    @Query('shelf') shelf: number,
    @Query('level') level: number,
    @Query('bin') bin: number,
  ): Promise<ProductAllocation | null> {
    return this.allocationService.findByNewCoordinates(floor, room, row, shelf, level, bin);
  }

  // NOVO: endpoint para leitura de QR de allocation
  @Post('scan')
  @ApiOperation({ summary: 'Escanear QR Code de allocation e criar/buscar alocação com próximo BIN automático' })
  @ApiResponse({ status: 200, description: 'Alocação criada/encontrada com sucesso' })
  @ApiQuery({ name: 'dryRun', description: 'Quando true, apenas pré-visualiza sem criar', required: false })
  async scanAllocation(
    @Body() body: { qr: string; conditionId: number },
    @Query('dryRun') dryRun?: string,
  ): Promise<ProductAllocation> {
    const isDryRun = typeof dryRun === 'string' ? dryRun === 'true' : false;
    return this.allocationService.scanAllocation(body.qr, body.conditionId, isDryRun);
  }
}