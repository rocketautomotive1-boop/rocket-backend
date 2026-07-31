import {
    Controller, Get, Post, Patch, Body, Param, Query, UseGuards, UseInterceptors,
    UploadedFiles, Request, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { SellerReplyDto } from './dto/seller-reply.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
    constructor(private readonly reviewsService: ReviewsService) { }

    @Post(':productId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Enviar avaliação (cliente autenticado)' })
    @UseInterceptors(FilesInterceptor('photos', 5))
    async create(
        @Param('productId') productId: string,
        @Body() dto: CreateReviewDto,
        @Request() req: any,
        @UploadedFiles() photos: any[] = [],
    ) {
        const customerId = req.user?.sub;
        if (!customerId) throw new BadRequestException('Cliente não identificado.');

        return this.reviewsService.create(
            productId,
            customerId,
            Number(dto.rating),
            dto.comment,
            photos.map(p => p.buffer),
        );
    }

    @SkipJwtAuth()
    @Get('product/:productId')
    @ApiOperation({ summary: 'Listar avaliações aprovadas de um produto' })
    async getProductReviews(
        @Param('productId') productId: string,
        @Query('page') page = 1,
        @Query('limit') limit = 10,
    ) {
        return this.reviewsService.getProductReviews(productId, Number(page), Number(limit));
    }

    @Post(':reviewId/helpful')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: "Marcar/desmarcar avaliação como 'útil' (toggle)" })
    async toggleHelpful(@Param('reviewId') reviewId: string, @Request() req: any) {
        const customerId = req.user?.sub;
        if (!customerId) throw new BadRequestException('Cliente não identificado.');
        return this.reviewsService.toggleHelpful(reviewId, customerId);
    }

    // ── Admin (rocket-b2b) ──────────────────────────────────────────────

    @Get('admin/moderation')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Listar avaliações para moderação (admin)' })
    async listForModeration(
        @Query('page') page = 1,
        @Query('limit') limit = 20,
        @Query('status') status?: 'APPROVED' | 'REJECTED',
    ) {
        return this.reviewsService.listForModeration(Number(page), Number(limit), status);
    }

    @Patch(':reviewId/moderate')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Aprovar/rejeitar avaliação (admin)' })
    async moderate(@Param('reviewId') reviewId: string, @Body() dto: ModerateReviewDto) {
        return this.reviewsService.moderate(reviewId, dto.status, dto.rejectionReason);
    }

    @Post(':reviewId/seller-reply')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Responder publicamente a uma avaliação (admin)' })
    async replyAsSeller(@Param('reviewId') reviewId: string, @Body() dto: SellerReplyDto, @Request() req: any) {
        return this.reviewsService.replyAsSeller(reviewId, dto.text, req.user?.email);
    }
}
