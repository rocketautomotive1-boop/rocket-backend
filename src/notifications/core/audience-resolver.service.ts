import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserModel, UserDocument } from '../../auth/schemas/user.schema';
import { AudienceSpec, Recipient } from '../contracts/notification.types';

@Injectable()
export class AudienceResolver {
  private readonly logger = new Logger(AudienceResolver.name);

  constructor(
    @InjectModel(UserModel.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async resolve(spec: AudienceSpec): Promise<Recipient[]> {
    try {
      return await this.resolveInner(spec);
    } catch (err) {
      this.logger.warn(
        `[Audience] resolução falhou (${(err as Error).message}); fail-open → all-admins`,
      );
      return this.resolveInner({ kind: 'all-admins' });
    }
  }

  private async resolveInner(spec: AudienceSpec): Promise<Recipient[]> {
    if (spec.kind === 'user') {
      const user = await this.userModel.findById(spec.userId).lean().exec();
      return user ? [this.toRecipient(user)] : [];
    }
    const filter =
      spec.kind === 'all-admins' ? { roles: 'admin', isActive: { $ne: false } }
      : spec.kind === 'role'      ? { roles: spec.role, isActive: { $ne: false } }
      : /* broadcast */             { isActive: { $ne: false } };
    const users = await this.userModel.find(filter as any).lean().exec();
    return users.map((u) => this.toRecipient(u));
  }

  private toRecipient(u: any): Recipient {
    return {
      userId: String(u._id),
      pushTokens: Array.isArray(u.pushTokens) ? u.pushTokens : [],
      email: u.email,
    };
  }
}
