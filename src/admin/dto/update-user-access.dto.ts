import { IsBoolean } from 'class-validator';

export class UpdateUserAccessDto {
  @IsBoolean()
  dashboardUnlocked: boolean;
}
