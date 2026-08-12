import { Controller, Get, Put, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserModel, UserDocument } from '../schemas/user.schema';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';

interface SetUserStoreBody {
  storeId: string | null;
}

/**
 * Listagem/edição mínima de usuários para a tela de gestão de lojas
 * (atribuir storeId). Time pequeno e fixo — sem paginação/busca.
 * Admin-only: storeId decide o roteamento de publicação por loja.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('users')
export class UserAdminController {
  constructor(
    @InjectModel(UserModel.name) private readonly userModel: Model<UserDocument>,
  ) {}

  @Get()
  async list() {
    const users = await this.userModel
      .find({}, { name: 1, email: 1, roles: 1, storeId: 1 })
      .lean()
      .exec();
    return users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      roles: u.roles ?? [],
      storeId: u.storeId ?? null,
    }));
  }

  @Put(':id/store')
  async setStore(@Param('id') id: string, @Body() body: SetUserStoreBody) {
    if (!('storeId' in body)) throw new BadRequestException('storeId é obrigatório (use null para desatribuir).');
    const result = await this.userModel.updateOne({ _id: id }, { $set: { storeId: body.storeId } }).exec();
    if (result.matchedCount === 0) throw new BadRequestException(`Usuário ${id} não encontrado.`);
    return { updated: true };
  }
}
