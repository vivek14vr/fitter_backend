import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlanInstanceStatus } from '../../auth/plan-instance-status.enum.js';

export class PlanAnswerDto {
  @IsString()
  @MaxLength(80)
  questionId: string;

  @IsDefined()
  value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  entryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  occurrence?: number;
}

export class UpdatePlanInstanceDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PlanAnswerDto)
  answers: PlanAnswerDto[];

  @IsEnum(PlanInstanceStatus)
  status: PlanInstanceStatus;
}
