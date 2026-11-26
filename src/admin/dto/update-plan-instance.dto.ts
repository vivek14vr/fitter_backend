import { IsISO8601, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdatePlanInstanceDto {
  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsMongoId()
  nutritionistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNotes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  planValidityDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  formFillingDays?: number;
}
