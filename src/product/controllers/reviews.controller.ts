import { Controller, Get, Post, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ReviewsService } from '../services/reviews.service';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
    constructor(private readonly reviewsService: ReviewsService) { }

    @Post(':productId')
    @ApiOperation({ summary: 'Submit a Review' })
    @ApiResponse({ status: 201, description: 'Review created successfully.' })
    async create(
        @Param('productId') productId: string,
        @Body() body: { userId: string; rating: number; comment: string; photos?: string[] }
    ) {
        if (!body.userId || !body.rating) {
            throw new BadRequestException('UserId and Rating are required.');
        }
        return this.reviewsService.create(productId, body.userId, body.rating, body.comment, body.photos);
    }

    @Get('product/:productId')
    @ApiOperation({ summary: 'Get Reviews for a Product' })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async getProductReviews(
        @Param('productId') productId: string,
        @Query('page') page = 1,
        @Query('limit') limit = 10
    ) {
        return this.reviewsService.getProductReviews(productId, Number(page), Number(limit));
    }
}
