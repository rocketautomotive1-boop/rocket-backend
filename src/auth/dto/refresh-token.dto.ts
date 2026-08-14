import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Refresh token (mobile — admin usa cookie HttpOnly)' })
  @IsOptional()
  @IsString()
  refresh_token?: string;
}
