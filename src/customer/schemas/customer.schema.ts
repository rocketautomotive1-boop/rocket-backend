import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CustomerDocument = HydratedDocument<CustomerModel>;

@Schema()
class CustomerAddressSnapshot {
    @Prop() alias: string;
    @Prop() street: string;
    @Prop() number: string;
    @Prop() complement: string;
    @Prop() neighborhood: string;
    @Prop() city: string;
    @Prop() state: string;
    @Prop() zipCode: string;
    @Prop({ default: false }) isDefault: boolean;
}

@Schema({ collection: 'customers', timestamps: true })
export class CustomerModel {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true, unique: true, index: true })
    email: string;

    @Prop()
    password?: string; // Hashed - Optional for social login

    @Prop({ index: true })
    document?: string; // CPF/CNPJ - Optional now for social login

    @Prop({ index: true })
    googleId?: string; // Google ID

    @Prop()
    avatar?: string; // Avatar URL

    @Prop()
    phone: string;

    @Prop({ default: true })
    isActive: boolean;

    @Prop({ type: [SchemaFactory.createForClass(CustomerAddressSnapshot)] })
    addresses: CustomerAddressSnapshot[];


}

export const CustomerSchema = SchemaFactory.createForClass(CustomerModel);
