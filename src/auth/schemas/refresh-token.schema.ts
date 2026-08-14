import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshTokenModel>;

@Schema({ collection: 'refresh_tokens', timestamps: { createdAt: true, updatedAt: false } })
export class RefreshTokenModel {
    @Prop({ required: true, index: true })
    userId: string;

    @Prop({ required: true, unique: true })
    tokenHash: string;

    @Prop({ required: true })
    deviceInfo: string;

    @Prop({ required: true, expires: 0 })
    expiresAt: Date;

    @Prop({ type: Date, default: null })
    revokedAt: Date | null;

    @Prop({ type: String, default: null })
    replacedByHash: string | null;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshTokenModel);
