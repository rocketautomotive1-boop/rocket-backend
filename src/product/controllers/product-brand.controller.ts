import { Controller, Get, Post, Body, Param, Put, Delete, ParseIntPipe, BadRequestException, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ProductBrandService } from '../services/product-brand.service';
import { BrandModel } from '../schemas/brand.schema';
import { CreateProductBrandDto } from '../dto/create-product-brand.dto';
import { UpdateProductBrandDto } from '../dto/update-product-brand.dto';


@ApiTags('brands')
@Controller('brands')
export class ProductBrandController {
  constructor(
    private readonly productBrandService: ProductBrandService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todas as marcas' })
  @ApiResponse({ status: 200, description: 'Lista de marcas retornada com sucesso' })
  async findAll(@Query('isGenuine') isGenuine?: string): Promise<BrandModel[]> {
    const onlyGenuine = String(isGenuine || '').toLowerCase() === 'true';
    return this.productBrandService.findAll(onlyGenuine);
  }

  @Get('search')
  @ApiOperation({ summary: 'Buscar marcas por termo (name, shortName ou fullName)' })
  @ApiResponse({ status: 200, description: 'Lista de marcas encontradas com sucesso' })
  @ApiQuery({ name: 'term', required: true, description: 'Termo de busca para name, shortName ou fullName' })
  async search(@Query('term') term: string, @Query('isGenuine') isGenuine?: string): Promise<BrandModel[]> {
    const onlyGenuine = String(isGenuine || '').toLowerCase() === 'true';
    return this.productBrandService.search(term, onlyGenuine);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter uma marca pelo ID' })
  @ApiResponse({ status: 200, description: 'Marca encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Marca não encontrada' })
  async findOne(@Param('id') id: string): Promise<BrandModel> {
    const brand = await this.productBrandService.findOne(id);
    if (!brand) {
      throw new BadRequestException(`Marca com ID ${id} não encontrada`);
    }
    return brand;
  }

  @Post()
  @ApiOperation({ summary: 'Criar uma nova marca' })
  @ApiResponse({ status: 201, description: 'Marca criada com sucesso' })
  async create(@Body() createProductBrandDto: CreateProductBrandDto): Promise<BrandModel> {
    return this.productBrandService.create(createProductBrandDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar uma marca' })
  @ApiResponse({ status: 200, description: 'Marca atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Marca não encontrada' })
  async update(
    @Param('id') id: string,
    @Body() updateProductBrandDto: UpdateProductBrandDto,
  ): Promise<any> {
    return this.productBrandService.update(id, updateProductBrandDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir uma marca' })
  @ApiResponse({ status: 200, description: 'Marca excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Marca não encontrada' })
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    await this.productBrandService.remove(id);
    return { success: true, message: 'Marca excluída com sucesso' };
  }
}