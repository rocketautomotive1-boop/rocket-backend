// backend/src/marketplace/auth/schemas/marketplace-account.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MarketplaceAccountDocument = HydratedDocument<MarketplaceAccountModel>;

@Schema({ _id: false })
export class MarketplaceAccountToken {
  @Prop() accessToken: string;
  @Prop() refreshToken: string;
  @Prop() expiresAt: Date;
  @Prop() tokenType: string;
  @Prop({ type: Object }) additionalData: Record<string, any>;
  @Prop({ default: true }) isActive: boolean;
}

@Schema({ collection: 'marketplace_accounts', timestamps: true })
export class MarketplaceAccountModel {
  _id: string;

  @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', required: true, index: true })
  marketplaceId: Types.ObjectId;

  @Prop({ required: true })
  label: string;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ type: [String], default: [] })
  domains: string[];

  /**
   * clientId/clientSecret etc — formato enc:v1:... (AES-256-GCM).
   * Use credentials-crypto.helper para ler/escrever. Nunca acessar plaintext direto.
   */
  @Prop({ type: Object, default: {} })
  credentials: Record<string, string>;

  @Prop({ type: MarketplaceAccountToken })
  token: MarketplaceAccountToken;

  @Prop()
  lockUntil?: Date;
}

export const MarketplaceAccountSchema = SchemaFactory.createForClass(MarketplaceAccountModel);

// No máximo 1 conta default por marketplace (índice único parcial).
MarketplaceAccountSchema.index(
  { marketplaceId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

// Evita duas contas com o mesmo label no mesmo marketplace.
MarketplaceAccountSchema.index({ marketplaceId: 1, label: 1 }, { unique: true });
