import { Controller, Get, Post, Body, Param, Put, Delete, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductUnitService } from '../services/product-unit.service';
import { ProductUnitModel as ProductUnit } from '../schemas/product-unit.schema';
import { CreateProductUnitDto } from '../dto/create-product-unit.dto';
import { UpdateProductUnitDto } from '../dto/update-product-unit.dto';

@ApiTags('units')
@Controller('units')
export class ProductUnitController {
  constructor(
    private readonly productUnitService: ProductUnitService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todas as unidades de medida' })
  @ApiResponse({ status: 200, description: 'Lista de unidades retornada com sucesso' })
  async findAll(): Promise<ProductUnit[]> {
    return this.productUnitService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter uma unidade pelo ID' })
  @ApiResponse({ status: 200, description: 'Unidade encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Unidade não encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ProductUnit> {
    const unit = await this.productUnitService.findOne(id);
    if (!unit) {
      throw new BadRequestException(`Unidade com ID ${id} não encontrada`);
    }
    return unit;
  }

  @Post()
  @ApiOperation({ summary: 'Criar uma nova unidade' })
  @ApiResponse({ status: 201, description: 'Unidade criada com sucesso' })
  async create(@Body() createProductUnitDto: CreateProductUnitDto): Promise<ProductUnit> {
    return this.productUnitService.create(createProductUnitDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar uma unidade' })
  @ApiResponse({ status: 200, description: 'Unidade atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Unidade não encontrada' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductUnitDto: UpdateProductUnitDto,
  ): Promise<ProductUnit> {
    return this.productUnitService.update(id, updateProductUnitDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir uma unidade' })
  @ApiResponse({ status: 200, description: 'Unidade excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Unidade não encontrada' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ success: boolean; message: string }> {
    await this.productUnitService.remove(id);
    return { success: true, message: 'Unidade excluída com sucesso' };
  }
}