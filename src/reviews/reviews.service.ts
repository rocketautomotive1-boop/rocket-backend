import { Injectable, Logger, ConflictException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { ReviewModel, ReviewDocument } from './schemas/review.schema';
import { CustomerService } from '../customer/customer.service';
import { OrderRepository } from '../order/order.repository';
import { S3Service } from '../common/s3/s3.service';
import { detectImageMimeType } from '../common/utils/image-mime.util';

const MAX_PHOTOS = 5;

@Injectable()
export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);

    constructor(
        @InjectModel(ReviewModel.name) private reviewModel: Model<ReviewDocument>,
        @InjectConnection() private readonly connection: Connection,
        private readonly customerService: CustomerService,
        private readonly orderRepository: OrderRepository,
        private readonly s3Service: S3Service,
    ) { }

    async create(
        productId: string,
        customerId: string,
        rating: number,
        comment: string,
        photoBuffers: Buffer[] = [],
    ): Promise<ReviewDocument> {
        if (photoBuffers.length > MAX_PHOTOS) {
            throw new BadRequestException(`Máximo de ${MAX_PHOTOS} fotos por avaliação.`);
        }

        const customer = await this.customerService.findOne(customerId);
        const verifiedPurchase = await this.hasDeliveredPurchase(customerId, productId);

        const photos = await this.uploadPhotos(productId, customerId, photoBuffers);

        try {
            const review = new this.reviewModel({
                productId: new Types.ObjectId(productId),
                customerId: new Types.ObjectId(customerId),
                customerName: customer.name,
                customerAvatar: (customer as any).avatar,
                rating,
                comment,
                photos,
                verifiedPurchase,
                status: 'APPROVED', // moderação reativa — admin rejeita depois se necessário
            });
            await review.save();

            await this.updateProductRating(productId);

            return review;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new ConflictException('Você já avaliou este produto.');
            }
            throw error;
        }
    }

    async getProductReviews(productId: string, page = 1, limit = 10) {
        const skip = (page - 1) * limit;
        const filter = { productId: new Types.ObjectId(productId), status: 'APPROVED' };

        const [reviews, total] = await Promise.all([
            this.reviewModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
            this.reviewModel.countDocuments(filter),
        ]);

        return {
            data: reviews,
            meta: { total, page, limit, pages: Math.ceil(total / limit) },
        };
    }

    /** Toggle: se o customer já votou, remove o voto; caso contrário, adiciona. */
    async toggleHelpful(reviewId: string, customerId: string): Promise<{ helpfulCount: number; voted: boolean }> {
        const review = await this.reviewModel.findById(reviewId).exec();
        if (!review) throw new NotFoundException('Avaliação não encontrada.');

        const customerObjectId = new Types.ObjectId(customerId);
        const alreadyVoted = review.helpfulVotes.some(id => id.equals(customerObjectId));

        if (alreadyVoted) {
            review.helpfulVotes = review.helpfulVotes.filter(id => !id.equals(customerObjectId));
        } else {
            review.helpfulVotes.push(customerObjectId);
        }
        await review.save();

        return { helpfulCount: review.helpfulVotes.length, voted: !alreadyVoted };
    }

    /** Resposta do vendedor (admin) — pública, aparece abaixo da review no b2c. */
    async replyAsSeller(reviewId: string, text: string, respondedBy?: string): Promise<ReviewDocument> {
        const review = await this.reviewModel.findById(reviewId).exec();
        if (!review) throw new NotFoundException('Avaliação não encontrada.');

        review.sellerReply = { text, respondedAt: new Date(), respondedBy };
        await review.save();
        return review;
    }

    /** Moderação reativa (admin): rejeita/remove uma review já publicada. */
    async moderate(reviewId: string, status: 'APPROVED' | 'REJECTED', rejectionReason?: string): Promise<ReviewDocument> {
        const review = await this.reviewModel.findById(reviewId).exec();
        if (!review) throw new NotFoundException('Avaliação não encontrada.');

        review.status = status;
        review.rejectionReason = status === 'REJECTED' ? rejectionReason : undefined;
        await review.save();

        await this.updateProductRating(String(review.productId));
        return review;
    }

    /** Lista para a tela de moderação do admin — inclui todos os status. */
    async listForModeration(page = 1, limit = 20, status?: 'APPROVED' | 'REJECTED') {
        const skip = (page - 1) * limit;
        const filter: any = {};
        if (status) filter.status = status;

        const [reviews, total] = await Promise.all([
            this.reviewModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
            this.reviewModel.countDocuments(filter),
        ]);

        return { data: reviews, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    /** true se o customer tem um Order DELIVERED contendo este produto. */
    private async hasDeliveredPurchase(customerId: string, productId: string): Promise<boolean> {
        const order = await this.orderRepository.findOne({
            'customer.customerId': new Types.ObjectId(customerId),
            'items.productId': new Types.ObjectId(productId),
            status: 'DELIVERED',
        });
        return !!order;
    }

    private async uploadPhotos(productId: string, customerId: string, buffers: Buffer[]): Promise<string[]> {
        const urls: string[] = [];
        for (let i = 0; i < buffers.length; i++) {
            const detected = detectImageMimeType(buffers[i]);
            if (detected.mime === 'application/octet-stream') {
                throw new BadRequestException('Uma das fotos enviadas não é uma imagem válida (jpg/png/webp/gif).');
            }
            const key = `reviews/${productId}/${customerId}-${Date.now()}-${i}.${detected.ext}`;
            const url = await this.s3Service.uploadFile(buffers[i], key, detected.mime, true);
            urls.push(url);
        }
        return urls;
    }

    private async updateProductRating(productId: string): Promise<void> {
        try {
            const stats = await this.reviewModel.aggregate([
                { $match: { productId: new Types.ObjectId(productId), status: 'APPROVED' } },
                { $group: { _id: '$productId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
            ]);

            const productModel = this.connection.model('ProductModel');
            if (stats.length > 0) {
                const { avgRating, count } = stats[0];
                await productModel.findByIdAndUpdate(productId, {
                    ratingAverage: parseFloat(avgRating.toFixed(1)),
                    ratingCount: count,
                });
            } else {
                await productModel.findByIdAndUpdate(productId, { ratingAverage: 0, ratingCount: 0 });
            }
        } catch (error: any) {
            this.logger.error(`Failed to update rating for product ${productId}`, error);
        }
    }
}
