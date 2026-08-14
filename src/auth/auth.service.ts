import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { UserModel, UserDocument } from './schemas/user.schema';
import { RefreshTokenModel, RefreshTokenDocument } from './schemas/refresh-token.schema';
import * as bcrypt from 'bcrypt';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(UserModel.name)
    private userModel: Model<UserDocument>,
    @InjectModel(RefreshTokenModel.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    private jwtService: JwtService,
  ) { }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userModel.findOne({ email }).exec();

    if (user && await this.comparePassword(password, user.password)) {
      const userObj = user.toObject();
      const { password, ...result } = userObj;
      // Ensure 'id' exists for compatibility
      return { ...result, id: user._id.toString() };
    }

    return null;
  }

  async login(user: any, deviceInfo: string) {
    const userId = user.id || user._id.toString(); // Support both
    const payload = {
      email: user.email,
      sub: userId,
      roles: user.roles,
      permissions: user.permissions
    };

    const refreshToken = await this.issueRefreshToken(userId, deviceInfo);

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        permissions: user.permissions,
      },
    };
  }

  async refresh(rawToken: string, deviceInfo: string) {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.refreshTokenModel.findOne({ tokenHash }).exec();

    if (!stored || stored.revokedAt) {
      if (stored) {
        await this.revokeAllSessions(stored.userId);
      }
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    const user = await this.userModel.findById(stored.userId).exec();
    if (!user) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    const newRefreshToken = await this.issueRefreshToken(stored.userId, deviceInfo);
    stored.revokedAt = new Date();
    stored.replacedByHash = this.hashToken(newRefreshToken);
    await stored.save();

    const payload = {
      email: user.email,
      sub: stored.userId,
      roles: user.roles,
      permissions: user.permissions,
    };

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: newRefreshToken,
    };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.refreshTokenModel.updateOne(
      { tokenHash, revokedAt: null },
      { revokedAt: new Date() },
    ).exec();
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllSessions(userId);
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.refreshTokenModel.updateMany(
      { userId, revokedAt: null },
      { revokedAt: new Date() },
    ).exec();
  }

  private async issueRefreshToken(userId: string, deviceInfo: string): Promise<string> {
    const rawToken = crypto.randomBytes(64).toString('hex');
    await this.refreshTokenModel.create({
      userId,
      tokenHash: this.hashToken(rawToken),
      deviceInfo,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    return rawToken;
  }

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  async register(userData: any): Promise<UserDocument> {
    const hashedPassword = await this.hashPassword(userData.password);

    const newUser = new this.userModel({
      email: userData.email,
      name: userData.name,
      password: hashedPassword,
      roles: userData.roles || ['user'],
      permissions: userData.permissions || [],
      isActive: true
    });

    return newUser.save();
  }

  async findById(id: string): Promise<UserDocument> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument> {
    return this.userModel.findOne({ email }).exec();
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt();
    return bcrypt.hash(password, salt);
  }

  private async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
