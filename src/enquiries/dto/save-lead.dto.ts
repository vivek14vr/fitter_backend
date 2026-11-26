import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { HEALTH_GOAL_CONCERNS } from './create-health-goal-enquiry.dto.js';

export class SaveLeadDto {
  @IsIn(['homepage-health-goal-popup', 'one-to-one-booking-popup'])
  source: 'homepage-health-goal-popup' | 'one-to-one-booking-popup';

  @IsInt()
  @Min(1)
  @Max(4)
  completedStep: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HEALTH_GOAL_CONCERNS.length)
  @IsIn(HEALTH_GOAL_CONCERNS, { each: true })
  @ArrayMinSize(1)
  concerns?: string[];

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  goal?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  timeline?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'Country code must start with + and contain up to four digits',
  })
  countryCode?: string;

  @IsOptional()
  @IsIn(['india', 'worldwide'])
  region?: 'india' | 'worldwide';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?=.*\d)[0-9+()\-\s]{7,25}$/, {
    message: 'Phone number must include at least one digit and only common phone symbols',
  })
  phone?: string;

  @IsOptional()
  @IsBoolean()
  @IsIn([true], { message: 'Consent must be accepted before continuing' })
  consent?: boolean;
}
