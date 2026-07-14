import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiChatSessionDocument = AiChatSessionModel & Document;

@Schema({ _id: false })
export class AiChatTurn {
    @Prop({ required: true, enum: ['user', 'model'] })
    role: 'user' | 'model';

    @Prop({ default: '' })
    text: string;

    @Prop({ type: Object })
    functionCall?: { name: string; args: any };

    @Prop({ default: Date.now })
    timestamp: Date;
}

export const AiChatTurnSchema = SchemaFactory.createForClass(AiChatTurn);

@Schema({ collection: 'ai_chat_sessions' })
export class AiChatSessionModel {
    @Prop({ required: true, unique: true, index: true })
    sessionId: string;

    @Prop()
    userId?: string;

    @Prop()
    vehicleId?: string;

    @Prop({ type: [AiChatTurnSchema], default: [] })
    turns: AiChatTurn[];

    @Prop({ default: Date.now })
    updatedAt: Date;
}

export const AiChatSessionSchema = SchemaFactory.createForClass(AiChatSessionModel);
AiChatSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 1800 });
