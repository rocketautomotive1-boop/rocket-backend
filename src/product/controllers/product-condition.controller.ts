import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ProductConditionService } from '../services/product-condition.service';
import { CreateProductConditionDto } from '../dto/create-product-condition.dto';
import { UpdateProductConditionDto } from '../dto/update-product-condition.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('product-conditions')
@UseGuards(JwtAuthGuard)
export class ProductConditionController {
  constructor(private readonly productConditionService: ProductConditionService) {}

  @Post()
  create(@Body() createProductConditionDto: CreateProductConditionDto) {
    return this.productConditionService.create(createProductConditionDto);
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.productConditionService.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productConditionService.findOne(+id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateProductConditionDto: UpdateProductConditionDto) {
    return this.productConditionService.update(+id, updateProductConditionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productConditionService.remove(+id);
  }
} 