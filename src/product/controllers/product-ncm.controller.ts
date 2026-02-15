import { Controller, Get, Post, Body, Param, Put, Delete, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductNCMService } from '../services/product-ncm.service';
import { ProductNCMModel as ProductNCM } from '../schemas/product-ncm.schema';
import { CreateProductNCMDto } from '../dto/create-product-ncm.dto';
import { UpdateProductNCMDto } from '../dto/update-product-ncm.dto';

@ApiTags('ncms')
@Controller('ncms')
export class ProductNCMController {
  constructor(
    private readonly productNCMService: ProductNCMService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todos os códigos NCM' })
  @ApiResponse({ status: 200, description: 'Lista de códigos NCM retornada com sucesso' })
  async findAll(): Promise<ProductNCM[]> {
    return this.productNCMService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um código NCM pelo ID' })
  @ApiResponse({ status: 200, description: 'Código NCM encontrado com sucesso' })
  @ApiResponse({ status: 404, description: 'Código NCM não encontrado' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ProductNCM> {
    const ncm = await this.productNCMService.findOne(id);
    if (!ncm) {
      throw new BadRequestException(`Código NCM com ID ${id} não encontrado`);
    }
    return ncm;
  }

  @Post()
  @ApiOperation({ summary: 'Criar um novo código NCM' })
  @ApiResponse({ status: 201, description: 'Código NCM criado com sucesso' })
  async create(@Body() createProductNCMDto: CreateProductNCMDto): Promise<ProductNCM> {
    return this.productNCMService.create(createProductNCMDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar um código NCM' })
  @ApiResponse({ status: 200, description: 'Código NCM atualizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Código NCM não encontrado' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductNCMDto: UpdateProductNCMDto,
  ): Promise<ProductNCM> {
    return this.productNCMService.update(id, updateProductNCMDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir um código NCM' })
  @ApiResponse({ status: 200, description: 'Código NCM excluído com sucesso' })
  @ApiResponse({ status: 404, description: 'Código NCM não encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ success: boolean; message: string }> {
    await this.productNCMService.remove(id);
    return { success: true, message: 'Código NCM excluído com sucesso' };
  }
}