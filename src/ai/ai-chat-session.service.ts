import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiChatSessionDocument, AiChatSessionModel, AiChatTurn } from './schemas/ai-chat-session.schema';

const HISTORY_WINDOW = 10;

@Injectable()
export class AiChatSessionService {
    constructor(
        @InjectModel(AiChatSessionModel.name)
        private readonly sessionModel: Model<AiChatSessionDocument>,
    ) { }

    async getRecentTurns(sessionId: string): Promise<AiChatTurn[]> {
        const session = await this.sessionModel
            .findOne({ sessionId })
            .select('turns')
            .lean()
            .exec();

        if (!session) return [];
        return session.turns.slice(-HISTORY_WINDOW);
    }

    async appendTurns(
        sessionId: string,
        newTurns: AiChatTurn[],
        meta?: { userId?: string; vehicleId?: string },
    ): Promise<void> {
        await this.sessionModel.updateOne(
            { sessionId },
            {
                $push: { turns: { $each: newTurns, $slice: -HISTORY_WINDOW } },
                $set: {
                    updatedAt: new Date(),
                    ...(meta?.userId ? { userId: meta.userId } : {}),
                    ...(meta?.vehicleId ? { vehicleId: meta.vehicleId } : {}),
                },
            },
            { upsert: true },
        ).exec();
    }
}
