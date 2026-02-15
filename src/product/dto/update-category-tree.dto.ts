import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize, IsOptional, IsNumber } from 'class-validator';

export class UpdateCategoryTreeDto {
    @ApiProperty({
        description: 'Full path of category names (e.g. ["Root", "Parent", "Child"])',
        example: ['Acessórios', 'Suspensão', 'Bieletas'],
        type: [String]
    })
    @IsArray()
    @IsString({ each: true })
    @ArrayMinSize(1)
    @IsOptional()
    path?: string[];

    @ApiProperty({ description: 'Alternative for path, from AI suggestion', required: false })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    suggestedTree?: string[];

    @ApiProperty({ required: false })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    synonyms?: string[];

    @ApiProperty({ required: false })
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    examples?: string[];

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    usageGuide?: string;

    @ApiProperty({ required: false, description: 'Score 0-100 indicating popularity' })
    @IsOptional()
    @IsNumber()
    relevance?: number;
}
