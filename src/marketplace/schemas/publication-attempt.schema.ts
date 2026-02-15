import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PublicationStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    PARTIAL_FAILURE = 'PARTIAL_FAILURE',
    FAILED = 'FAILED',
}

export class PublicationResult {
    marketplaceName: string;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    message?: string;
    externalId?: string;
    duration?: number;
    error?: string;
}

export class PublicationLogEntry {
    timestamp: Date;
    level: 'INFO' | 'WARN' | 'ERROR';
    message: string;
    context?: any;
}

export type PublicationAttemptDocument = PublicationAttempt & Document;

@Schema({ timestamps: true, collection: 'publication_attempts' })
export class PublicationAttempt {
    @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
    productId: Types.ObjectId;

    @Prop({ required: true, enum: PublicationStatus, default: PublicationStatus.PENDING, index: true })
    status: PublicationStatus;

    @Prop({ required: true })
    triggeredBy: string; // e.g., 'ProductService.update', 'ManualTrigger'

    @Prop({ type: [String], default: [] })
    targetMarketplaces: string[]; // List of marketplace IDs or Names targeted

    @Prop({ type: Array, default: [] })
    results: PublicationResult[];

    @Prop({ type: Array, default: [] })
    logs: PublicationLogEntry[];

    @Prop({ type: Object })
    metadata: any; // Any extra context (userId, etc)

    createdAt: Date;
    updatedAt: Date;
}

export const PublicationAttemptSchema = SchemaFactory.createForClass(PublicationAttempt);
