import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserModel, UserDocument } from './schemas/user.schema';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(UserModel.name)
    private userModel: Model<UserDocument>,
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

  async login(user: any) {
    const payload = {
      email: user.email,
      sub: user.id || user._id.toString(), // Support both
      roles: user.roles,
      permissions: user.permissions
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        permissions: user.permissions,
      },
    };
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
