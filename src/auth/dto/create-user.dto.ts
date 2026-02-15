import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'usuario@exemplo.com', description: 'Email do usuário' })
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'Email é obrigatório' })
  email: string;

  @ApiProperty({ example: 'Nome Completo', description: 'Nome do usuário' })
  @IsString({ message: 'Nome deve ser uma string' })
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  name: string;

  @ApiProperty({ example: 'Senha123!', description: 'Senha do usuário' })
  @IsString({ message: 'Senha deve ser uma string' })
  @MinLength(6, { message: 'Senha deve ter pelo menos 6 caracteres' })
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  password: string;

  @ApiPropertyOptional({ example: ['admin', 'user'], description: 'Papéis do usuário' })
  @IsArray({ message: 'Roles deve ser um array' })
  @IsOptional()
  roles?: string[];

  @ApiPropertyOptional({ example: ['create:product', 'read:marketplace'], description: 'Permissões do usuário' })
  @IsArray({ message: 'Permissões deve ser um array' })
  @IsOptional()
  permissions?: string[];
}
