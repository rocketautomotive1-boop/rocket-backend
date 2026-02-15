import { Controller, Get, Post, Body, Param, Delete, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { CompatibilitiesService } from '../compatibilities.service';
import { SearchCompatibilitiesDto } from '../dto/search-compatibilities.dto';
import { CreateProductCompatibilityDto } from '../dto/create-product-compatibility.dto';

@Controller('compatibilities')
export class CompatibilitiesController {
  constructor(private readonly compatibilitiesService: CompatibilitiesService) { }

  @Get('brands')
  async getBrands() {
    return this.compatibilitiesService.getVehicleBrands();
  }

  @Post('search-vehicles')
  async searchVehicles(@Body() searchDto: SearchCompatibilitiesDto) {
    return this.compatibilitiesService.searchCompatibleVehicles(searchDto);
  }

  @Post('save')
  async saveCompatibilities(@Body() createDtos: CreateProductCompatibilityDto[]) {
    return this.compatibilitiesService.createMany(createDtos);
  }

  @Get('product/:productId')
  async getByProductId(@Param('productId') productId: number) {
    return this.compatibilitiesService.findByProductId(productId);
  }

  @Get('search')
  async search(@Body() searchDto: SearchCompatibilitiesDto) {
    return this.compatibilitiesService.findAll(searchDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      return await this.compatibilitiesService.remove(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao remover compatibilidade.');
    }
  }

  @Post('attribute-options/:attributeId')
  async getAttributeOptions(
    @Param('attributeId') attributeId: string,
    @Body() body: { known_attributes?: any[] }
  ) {
    return this.compatibilitiesService.getAttributeOptions(attributeId, body.known_attributes || []);
  }
}