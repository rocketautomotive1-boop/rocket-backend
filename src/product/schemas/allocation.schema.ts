import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { BoxModel, BoxSchema } from './box.schema';

export type AllocationDocument = AllocationModel & Document;

@Schema({
    collection: 'allocations',
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret: any) {
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
            return ret;
        }
    }
})
export class AllocationModel {
    // Referencia WarehouseModel (legado, sem loja) OU StoreListingWarehouseModel
    // (novo, com storeId) — o tipo de warehouse é resolvido por quem chama, não
    // pelo schema. storeId nunca é denormalizado aqui: quando o warehouse é
    // store-aware, a loja é sempre obtida por join em StoreListingWarehouseModel,
    // mesmo padrão de StoreListingDamagedAllocationModel.
    @Prop({ type: Types.ObjectId, required: true, index: true })
    warehouseId: Types.ObjectId;

    @Prop({ required: true, index: true })
    locationPath: string;

    @Prop({ type: Object, default: {} })
    metadata: Record<string, any>;

    @Prop({ required: true, default: true, index: true })
    available: boolean;

    @Prop({ required: true, default: true })
    active: boolean;

    @Prop({ type: [BoxSchema], default: [] })
    boxes: BoxModel[];
}

export const AllocationSchema = SchemaFactory.createForClass(AllocationModel);

AllocationSchema.index({ warehouseId: 1, locationPath: 1 }, { unique: true });
