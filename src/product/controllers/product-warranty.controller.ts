import { Controller, Get, Post, Body, Param, Put, Delete, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductWarrantyService } from '../services/product-warranty.service';
import { ProductWarrantyModel as ProductWarranty } from '../schemas/product-warranty.schema';
import { CreateProductWarrantyDto } from '../dto/create-product-warranty.dto';
import { UpdateProductWarrantyDto } from '../dto/update-product-warranty.dto';

@ApiTags('warranties')
@Controller('warranties')
export class ProductWarrantyController {
  constructor(
    private readonly productWarrantyService: ProductWarrantyService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todas as garantias' })
  @ApiResponse({ status: 200, description: 'Lista de garantias retornada com sucesso' })
  async findAll(): Promise<ProductWarranty[]> {
    return this.productWarrantyService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter uma garantia pelo ID' })
  @ApiResponse({ status: 200, description: 'Garantia encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Garantia não encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ProductWarranty> {
    const warranty = await this.productWarrantyService.findOne(id);
    if (!warranty) {
      throw new BadRequestException(`Garantia com ID ${id} não encontrada`);
    }
    return warranty;
  }

  @Post()
  @ApiOperation({ summary: 'Criar uma nova garantia' })
  @ApiResponse({ status: 201, description: 'Garantia criada com sucesso' })
  async create(@Body() createProductWarrantyDto: CreateProductWarrantyDto): Promise<ProductWarranty> {
    return this.productWarrantyService.create(createProductWarrantyDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar uma garantia' })
  @ApiResponse({ status: 200, description: 'Garantia atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Garantia não encontrada' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductWarrantyDto: UpdateProductWarrantyDto,
  ): Promise<ProductWarranty> {
    return this.productWarrantyService.update(id, updateProductWarrantyDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir uma garantia' })
  @ApiResponse({ status: 200, description: 'Garantia excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Garantia não encontrada' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ success: boolean; message: string }> {
    await this.productWarrantyService.remove(id);
    return { success: true, message: 'Garantia excluída com sucesso' };
  }
}