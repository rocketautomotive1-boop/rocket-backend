import { IsString, IsEnum, IsOptional, IsBoolean, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BannerActionType, BannerPosition } from '../schemas/banner.schema';

export class CreateBannerDto {
    @ApiProperty()
    @IsString()
    title: string;

    @ApiProperty({ required: false })
    @IsString()
    @IsOptional()
    subtitle?: string;

    @ApiProperty()
    @IsString()
    imageDesktop: string;

    @ApiProperty({ required: false })
    @IsString()
    @IsOptional()
    imageMobile?: string;

    @ApiProperty({ enum: BannerActionType })
    @IsEnum(BannerActionType)
    actionType: BannerActionType;

    @ApiProperty()
    @IsString()
    actionValue: string;

    @ApiProperty({ enum: BannerPosition })
    @IsEnum(BannerPosition)
    position: BannerPosition;

    @ApiProperty({ required: false, default: 0 })
    @IsNumber()
    @IsOptional()
    order?: number;

    @ApiProperty({ required: false, default: true })
    @IsBoolean()
    @IsOptional()
    active?: boolean;

    @ApiProperty({ required: false })
    @IsDateString()
    @IsOptional()
    startDate?: Date;

    @ApiProperty({ required: false })
    @IsDateString()
    @IsOptional()
    endDate?: Date;

    @ApiProperty({ required: false })
    @IsString()
    @IsOptional()
    badgeText?: string;

    @ApiProperty({ required: false })
    @IsString()
    @IsOptional()
    badgeColor?: string;
}
