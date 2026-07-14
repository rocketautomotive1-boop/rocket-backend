import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SellerReplyDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    text: string;
}
