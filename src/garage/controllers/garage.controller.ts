import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GarageService } from '../services/garage.service';
import { AddGarageVehicleDto } from '../dto/add-garage-vehicle.dto';

@UseGuards(JwtAuthGuard)
@Controller('me/garage')
export class GarageController {
  constructor(private readonly service: GarageService) {}

  @Get()
  list(@Request() req) {
    return this.service.list(req.user.sub);
  }

  @Post()
  add(@Request() req, @Body() dto: AddGarageVehicleDto) {
    return this.service.add(req.user.sub, dto);
  }

  @Patch(':id/activate')
  activate(@Request() req, @Param('id') id: string) {
    return this.service.activate(req.user.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.service.remove(req.user.sub, id);
  }
}
