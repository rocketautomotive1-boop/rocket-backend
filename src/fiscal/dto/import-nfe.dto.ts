import { IsString, IsNotEmpty, IsNumber, Min, IsArray, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class MapItemDto {
    @IsString()
    @IsNotEmpty()
    itemCode: string;

    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    @Min(0.01)
    conversionFactor: number;
}

export class ConferenceScanDto {
    @IsString()
    @IsNotEmpty()
    itemCode: string;

    @IsString()
    @IsOptional()
    brandName?: string;

    @IsNumber()
    @IsOptional()
    quantity?: number;
}

export class CreateProductDraftDto {
    @IsString()
    @IsOptional()
    brandName?: string;
}

export class ConferenceItemDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsNumber()
    @Min(0)
    quantity: number;
}

export class UpdateConferenceDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ConferenceItemDto)
    items: ConferenceItemDto[];
}

export class LinkProductDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    @IsOptional()
    conversionFactor: number;
}

export class UpdateBrandDto {
    @IsString()
    @IsNotEmpty()
    itemCode: string;

    @IsString()
    @IsOptional()
    brandName?: string;

    @IsBoolean()
    @IsOptional()
    noBrand?: boolean;
}

export class BulkUpdateBrandDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateBrandDto)
    items: UpdateBrandDto[];
}
