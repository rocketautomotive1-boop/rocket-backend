import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<UserModel>;

@Schema({ collection: 'users', timestamps: true })
export class UserModel {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true, unique: true })
    email: string;

    @Prop({ required: true })
    password: string; // Hash

    @Prop({ default: true })
    isActive: boolean;

    @Prop([String])
    roles: string[];

    @Prop([String])
    permissions: string[];

    /** Loja/grupo do operador — dono da conta de publicação por marketplace dos
     *  produtos que ele criar. Ver GroupModel. */
    @Prop({ type: String, default: null })
    groupId: string | null;

    @Prop([String])
    pushTokens: string[];

    @Prop([{
        vehicleId: { type: String, ref: 'VehicleModel' },
        isPrimary: { type: Boolean, default: false },
        nickname: String
    }])
    garage: {
        vehicleId: string;
        isPrimary: boolean;
        nickname?: string;
    }[];


}

export const UserSchema = SchemaFactory.createForClass(UserModel);
