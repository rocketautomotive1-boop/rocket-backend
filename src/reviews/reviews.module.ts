import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReviewModel, ReviewSchema } from './schemas/review.schema';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { OrderModule } from '../order/order.module';
import { S3Module } from '../common/s3/s3.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: ReviewModel.name, schema: ReviewSchema }]),
        AuthModule,
        CustomerModule,
        OrderModule,
        S3Module,
    ],
    controllers: [ReviewsController],
    providers: [ReviewsService],
    exports: [ReviewsService],
})
export class ReviewsModule { }
