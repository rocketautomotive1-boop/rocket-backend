
import { IsString, IsEmail, IsNotEmpty, IsOptional, MinLength, IsBoolean } from 'class-validator';

export class CreateCustomerDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @MinLength(6)
    @IsNotEmpty()
    password: string;

    @IsString()
    @IsOptional()
    document?: string;

    @IsString()
    @IsOptional()
    phone?: string;
}
