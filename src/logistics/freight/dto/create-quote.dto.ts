import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RecipientDto {
    @ApiProperty({ example: '06210050', required: false })
    @IsString()
    @IsOptional()
    postalCode?: string;

    @ApiProperty({ example: 'BR', required: false, default: 'BR' })
    @IsString()
    @IsOptional()
    countryCode?: string = 'BR';

    @ApiProperty({ example: '12345678901', required: false })
    @IsString()
    @IsOptional()
    @ApiProperty({ example: '12345678901', required: false })
    @IsString()
    @IsOptional()
    document?: string;

    @ApiProperty({ example: 'Rua das Flores', required: false })
    @IsString()
    @IsOptional()
    street?: string;

    @ApiProperty({ example: '123', required: false })
    @IsString()
    @IsOptional()
    number?: string;

    @ApiProperty({ example: 'São Paulo', required: false })
    @IsString()
    @IsOptional()
    city?: string;

    @ApiProperty({ example: 'SP', required: false })
    @IsString()
    @IsOptional()
    state?: string;
}

export class ItemDto {
    @ApiProperty({ example: 0.15 })
    @IsNumber()
    @IsNotEmpty()
    weight: number;

    @ApiProperty({ example: 20 })
    @IsNumber()
    @IsNotEmpty()
    length: number;

    @ApiProperty({ example: 18 })
    @IsNumber()
    @IsNotEmpty()
    width: number;

    @ApiProperty({ example: 5 })
    @IsNumber()
    @IsNotEmpty()
    height: number;

    @ApiProperty({ example: 100, required: false })
    @IsNumber()
    @IsOptional()
    price: number = 0;

    // Fields from client payload
    @ApiProperty({ required: false, description: 'Client payload compatibility' })
    @IsNumber()
    @IsOptional()
    quantity?: number;

    @ApiProperty({ required: false, description: 'Client payload compatibility: Maps to price' })
    @IsNumber()
    @IsOptional()
    insuranceValue?: number;
}

export class CreateQuoteDto {
    @ApiProperty({ required: false })
    @ValidateNested()
    @Type(() => RecipientDto)
    @IsOptional()
    recipient?: RecipientDto;

    @ApiProperty({ type: [ItemDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ItemDto)
    @IsNotEmpty()
    items: ItemDto[];

    // Fields from client payload
    @ApiProperty({ required: false, description: 'Client payload compatibility: Maps to recipient.postalCode' })
    @IsString()
    @IsOptional()
    destinationZip?: string;
}
