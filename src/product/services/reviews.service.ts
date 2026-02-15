import { Injectable, Logger, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ReviewModel, ReviewDocument } from '../schemas/review.schema';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { SearchService } from '../../search/search.service';

@Injectable()
export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);

    constructor(
        @InjectModel(ReviewModel.name) private reviewModel: Model<ReviewDocument>,
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @Inject(forwardRef(() => SearchService))
        private readonly searchService: SearchService
    ) { }

    async create(productId: string, userId: string, rating: number, comment: string, photos: string[] = []) {
        try {
            // 1. Create Review
            const review = new this.reviewModel({
                productId: new Types.ObjectId(productId),
                userId: new Types.ObjectId(userId),
                rating,
                comment,
                photos,
                status: 'APPROVED' // Auto-approve for MVP
            });
            await review.save();

            // 2. Trigger Aggregation
            await this.updateProductRating(productId);

            return review;
        } catch (error) {
            if (error.code === 11000) {
                throw new ConflictException('User already reviewed this product.');
            }
            throw error;
        }
    }

    async getProductReviews(productId: string, page = 1, limit = 10) {
        const skip = (page - 1) * limit;
        const reviews = await this.reviewModel.find({
            productId: new Types.ObjectId(productId),
            status: 'APPROVED'
        })
            .populate('userId', 'name avatar') // Assuming User model has name/avatar
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .exec();

        const total = await this.reviewModel.countDocuments({
            productId: new Types.ObjectId(productId),
            status: 'APPROVED'
        });

        return {
            data: reviews,
            meta: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        };
    }

    private async updateProductRating(productId: string) {
        try {
            const stats = await this.reviewModel.aggregate([
                { $match: { productId: new Types.ObjectId(productId), status: 'APPROVED' } },
                {
                    $group: {
                        _id: '$productId',
                        avgRating: { $avg: '$rating' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            let updatedProduct: ProductDocument | null = null;

            if (stats.length > 0) {
                const { avgRating, count } = stats[0];
                updatedProduct = await this.productModel.findByIdAndUpdate(productId, {
                    ratingAverage: parseFloat(avgRating.toFixed(1)), // 1 decimal place
                    ratingCount: count
                }, { new: true });
            } else {
                // If last review deleted
                updatedProduct = await this.productModel.findByIdAndUpdate(productId, {
                    ratingAverage: 0,
                    ratingCount: 0
                }, { new: true });
            }

            if (updatedProduct) {
                // Sync to Elasticsearch with new Ratings + Existing Data
                // Note: indexProduct will refetch compatibilities/cross-refs automatically
                await this.searchService.indexProduct(updatedProduct);
            }

        } catch (error) {
            this.logger.error(`Failed to update rating for product ${productId}`, error);
        }
    }
}
