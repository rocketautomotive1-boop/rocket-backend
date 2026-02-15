
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SearchHistoryDocument = SearchHistory & Document;

@Schema({ timestamps: true })
export class SearchHistory {
    @Prop()
    userId?: string;

    @Prop()
    sessionId?: string;

    @Prop({ required: true, trim: true })
    term: string;

    @Prop({ default: 1 })
    count: number;

    @Prop({ default: Date.now })
    lastSearchedAt: Date;
}

// Compound index to quickly find/update specific term for a user/session
export const SearchHistorySchema = SchemaFactory.createForClass(SearchHistory);
SearchHistorySchema.index({ userId: 1, term: 1 });
SearchHistorySchema.index({ sessionId: 1, term: 1 });
SearchHistorySchema.index({ lastSearchedAt: -1 }); // For "Recent" queries
