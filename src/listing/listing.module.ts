import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ListingModel, ListingSchema } from './schemas/listing.schema';
import { ListingService } from './listing.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: ListingModel.name, schema: ListingSchema }])
    ],
    providers: [ListingService],
    exports: [ListingService, MongooseModule], // Export MongooseModule if we want to inject Model directly elsewhere
})
export class ListingModule { }
