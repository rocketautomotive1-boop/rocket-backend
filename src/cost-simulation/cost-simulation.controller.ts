import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CostSimulationService, PreviewInput, PreviewResult } from './cost-simulation.service';

@ApiTags('Cost Simulation')
@Controller('cost-simulation')
export class CostSimulationController {
  constructor(private readonly service: CostSimulationService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Simula custos/lucro de um produto no ML (live)' })
  async preview(@Body() body: PreviewInput): Promise<PreviewResult> {
    return this.service.preview({
      ...body,
      listingTypeId: body.listingTypeId ?? 'gold_special',
      logisticType: body.logisticType ?? 'drop_off',
      includeTax: body.includeTax ?? false,
    });
  }
}
