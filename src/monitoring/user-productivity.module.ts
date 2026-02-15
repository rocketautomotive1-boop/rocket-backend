import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserProductivityController } from './user-productivity.controller';
import { UserProductivityService } from './user-productivity.service';
import { UserProductivity, UserProductivitySchema } from './schemas/user-productivity.schema';
import { MarketplaceModule } from '../marketplace/marketplace.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: UserProductivity.name, schema: UserProductivitySchema }
        ]),
        forwardRef(() => MarketplaceModule) // For Marketplace Lookups if needed internally, though aggregation uses $lookup
    ],
    controllers: [UserProductivityController],
    providers: [UserProductivityService],
    exports: [UserProductivityService]
})
export class UserProductivityModule { }
