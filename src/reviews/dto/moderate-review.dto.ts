import { IsIn, IsOptional, IsString } from 'class-validator';

export class ModerateReviewDto {
    @IsIn(['APPROVED', 'REJECTED'])
    status: 'APPROVED' | 'REJECTED';

    @IsString()
    @IsOptional()
    rejectionReason?: string;
}
