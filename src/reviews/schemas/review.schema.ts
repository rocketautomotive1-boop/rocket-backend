import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<ReviewModel>;

@Schema({ _id: false })
class SellerReplySnapshot {
    @Prop({ required: true })
    text: string;

    @Prop({ required: true })
    respondedAt: Date;

    @Prop()
    respondedBy?: string; // nome/identificação do admin que respondeu
}

@Schema({ collection: 'reviews', timestamps: true })
export class ReviewModel {
    _id: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    productId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'CustomerModel', required: true })
    customerId: Types.ObjectId;

    /** Snapshot do nome no momento da review — evita populate cross-collection na leitura. */
    @Prop({ required: true })
    customerName: string;

    @Prop()
    customerAvatar?: string;

    @Prop({ required: true, min: 1, max: 5 })
    rating: number;

    @Prop({ required: true, minlength: 10, maxlength: 2000 })
    comment: string;

    @Prop({ type: [String], default: [], validate: [(v: string[]) => v.length <= 5, 'Máximo de 5 fotos por avaliação.'] })
    photos: string[];

    /** true quando o customerId tem um Order DELIVERED com este productId — selo "Compra verificada". */
    @Prop({ default: false, index: true })
    verifiedPurchase: boolean;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'CustomerModel' }], default: [] })
    helpfulVotes: Types.ObjectId[];

    @Prop({ default: 'APPROVED', enum: ['APPROVED', 'REJECTED'], index: true })
    status: string;

    @Prop()
    rejectionReason?: string;

    @Prop({ type: SellerReplySnapshot })
    sellerReply?: SellerReplySnapshot;

    @Prop()
    createdAt?: Date;

    @Prop()
    updatedAt?: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(ReviewModel);

// Um review por cliente por produto.
ReviewSchema.index({ productId: 1, customerId: 1 }, { unique: true });
ReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
