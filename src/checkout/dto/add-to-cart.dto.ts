import { IsInt, IsNotEmpty, IsPositive } from 'class-validator';

export class AddToCartDto {
    @IsNotEmpty()
    productId: string | number;

    @IsInt()
    @IsPositive()
    quantity: number;
}
