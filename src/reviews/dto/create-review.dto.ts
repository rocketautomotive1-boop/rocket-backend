import { IsInt, IsNotEmpty, IsString, Max, Min, MinLength, MaxLength } from 'class-validator';

export class CreateReviewDto {
    @IsInt()
    @Min(1)
    @Max(5)
    rating: number;

    @IsString()
    @MinLength(10, { message: 'O comentário deve ter pelo menos 10 caracteres.' })
    @MaxLength(2000)
    comment: string;
}
