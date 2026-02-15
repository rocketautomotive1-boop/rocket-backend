import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { BoxItemService } from '../services/box-item.service';
import { CreateBoxItemDto } from '../dto/create-box-item.dto';
import { UpdateBoxItemDto } from '../dto/update-box-item.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('box-items')
export class BoxItemController {
  constructor(private readonly boxItemService: BoxItemService) {}

  @Post()
  create(@Body() createBoxItemDto: CreateBoxItemDto) {
    return this.boxItemService.create(createBoxItemDto);
  }

  @Post('multiple')
  addMultipleItems(@Body() data: { boxId: number; items: CreateBoxItemDto[] }) {
    return this.boxItemService.addMultipleItems(data.boxId, data.items);
  }

  @Get()
  findAll(@Query('boxId') boxId?: string) {
    return this.boxItemService.findAll(boxId ? +boxId : undefined);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.boxItemService.findOne(+id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateBoxItemDto: UpdateBoxItemDto) {
    return this.boxItemService.update(+id, updateBoxItemDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.boxItemService.remove(+id);
  }

  @Get('product/:productId')
  getByProduct(@Param('productId') productId: string) {
    return this.boxItemService.getBoxItemsByProduct(+productId);
  }

  @Get('condition/:conditionId')
  getByCondition(@Param('conditionId') conditionId: string) {
    return this.boxItemService.getBoxItemsByCondition(+conditionId);
  }

  @Get('box/:boxId/summary')
  getBoxSummary(@Param('boxId') boxId: string) {
    return this.boxItemService.getBoxItemsSummary(+boxId);
  }
} 