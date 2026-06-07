import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { UserModel, UserDocument } from '../../auth/schemas/user.schema';

@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(
    @InjectModel(UserModel.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async registerToken(userId: string, token: string): Promise<boolean> {
    if (!userId || !token || userId === 'NaN' || !isValidObjectId(userId)) {
      this.logger.warn(`Invalid userId or token: ${userId}`);
      return false;
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) { this.logger.warn(`User ${userId} not found`); return false; }

    const tokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    if (!tokens.includes(token)) {
      user.pushTokens = [token, ...tokens].slice(0, 10);
      await user.save();
    }
    return true;
  }
}
