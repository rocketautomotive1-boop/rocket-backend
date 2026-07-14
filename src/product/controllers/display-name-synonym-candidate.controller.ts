import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { DisplayNameSynonymCandidateService } from '../services/display-name-synonym-candidate.service';

@Controller('display-name-synonym-candidates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DisplayNameSynonymCandidateController {
    constructor(private readonly candidateService: DisplayNameSynonymCandidateService) { }

    @Get()
    listPending() {
        return this.candidateService.listPending();
    }

    @Post(':id/approve')
    approve(@Param('id') id: string) {
        return this.candidateService.approve(id);
    }

    @Post(':id/reject')
    reject(@Param('id') id: string) {
        return this.candidateService.reject(id);
    }
}
