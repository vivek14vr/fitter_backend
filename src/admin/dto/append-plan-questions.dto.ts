import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePlanQuestionDto } from './create-plan.dto.js';

export class AppendPlanQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreatePlanQuestionDto)
  questions: CreatePlanQuestionDto[];
}
