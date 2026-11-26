import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PlanQuestionType } from '../../auth/plan-question-type.enum.js';

export class CreatePlanQuestionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  label: string;

  @IsEnum(PlanQuestionType)
  type: PlanQuestionType;

  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  helpText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  options?: string[];

  @IsInt()
  @Min(1)
  @Max(24)
  repeatPerDay: number;
}

export class CreatePlanDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(10)
  @MaxLength(240)
  description: string;

  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  validityDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  formFillingDays?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreatePlanQuestionDto)
  questions: CreatePlanQuestionDto[];
}
