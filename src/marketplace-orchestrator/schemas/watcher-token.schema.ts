import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WatcherTokenDocument = WatcherToken & Document;

@Schema({ collection: 'watcher_tokens', timestamps: true })
export class WatcherToken {
    @Prop({ required: true, unique: true })
    watcherName: string; // e.g., 'products-watcher', 'listings-watcher'

    @Prop({ required: true, type: Object })
    resumeToken: any; // The MongoDB Change Stream token
}

export const WatcherTokenSchema = SchemaFactory.createForClass(WatcherToken);
