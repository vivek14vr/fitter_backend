import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlanInstanceStatus } from '../../auth/plan-instance-status.enum.js';

export class ReviewPlanInstanceDto {
  @IsEnum(PlanInstanceStatus)
  status: PlanInstanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
