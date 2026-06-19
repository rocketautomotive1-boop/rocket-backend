import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QuestionDocument = HydratedDocument<QuestionModel>;

@Schema({ collection: 'questions', timestamps: true })
export class QuestionModel {
    @Prop({ required: true, unique: true, index: true })
    externalId: string;

    @Prop()
    itemId: string; // ID on the marketplace

    @Prop({ required: true })
    question: string;

    @Prop()
    answer: string;

    @Prop({ default: 'UNANSWERED', index: true })
    status: string;

    @Prop()
    buyerId: string;

    @Prop()
    dateCreated: Date;

    @Prop()
    dateAnswered: Date;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', index: true })
    product: Types.ObjectId;

    @Prop({ type: Types.ObjectId, required: true })
    marketplaceId: Types.ObjectId;

    @Prop()
    buyerName: string;

    @Prop()
    aiSuggestedAnswer: string;

    @Prop({ default: false })
    aiSuggestionUsed: boolean;

    @Prop()
    responseTimeMinutes: number;

    @Prop({ default: false })
    notified: boolean;
}

export const QuestionSchema = SchemaFactory.createForClass(QuestionModel);
