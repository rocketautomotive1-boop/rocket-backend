import { Controller, Get, Put, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserModel, UserDocument } from '../schemas/user.schema';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';

interface SetUserGroupBody {
  groupId: string | null;
}

/**
 * Listagem/edição mínima de usuários para a tela de gestão de lojas
 * (atribuir groupId). Time pequeno e fixo — sem paginação/busca.
 * Admin-only: groupId decide o roteamento de publicação por loja.
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
      .find({}, { name: 1, email: 1, roles: 1, groupId: 1 })
      .lean()
      .exec();
    return users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      roles: u.roles ?? [],
      groupId: u.groupId ?? null,
    }));
  }

  @Put(':id/group')
  async setGroup(@Param('id') id: string, @Body() body: SetUserGroupBody) {
    if (!('groupId' in body)) throw new BadRequestException('groupId é obrigatório (use null para desatribuir).');
    const result = await this.userModel.updateOne({ _id: id }, { $set: { groupId: body.groupId } }).exec();
    if (result.matchedCount === 0) throw new BadRequestException(`Usuário ${id} não encontrado.`);
    return { updated: true };
  }
}
