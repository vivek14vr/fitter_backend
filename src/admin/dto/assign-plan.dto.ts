import { IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

export class AssignPlanDto {
  @IsString()
  @IsMongoId()
  planId: string;

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
