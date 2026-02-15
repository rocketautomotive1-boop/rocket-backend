import { IsInt, IsNotEmpty, IsPositive } from 'class-validator';

export class UpdateCartItemDto {
    @IsNotEmpty()
    productId: string | number;

    @IsInt()
    @IsPositive()
    quantity: number;
}
