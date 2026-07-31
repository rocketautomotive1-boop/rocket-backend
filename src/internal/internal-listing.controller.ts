import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InternalKeyGuard } from './internal-key.guard';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';
import { ListingModel } from '../listing/schemas/listing.schema';

@SkipJwtAuth()
@UseGuards(InternalKeyGuard)
@SkipThrottle()
@Controller('internal/listings')
export class InternalListingController {
    constructor(
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
    ) {}

    @Get(':id/external-id')
    async getExternalId(@Param('id') id: string) {
        const listing = await this.listingModel
            .findById(id)
            .select('externalId')
            .lean()
            .exec();
        return { externalId: (listing as any)?.externalId ?? null };
    }
}
