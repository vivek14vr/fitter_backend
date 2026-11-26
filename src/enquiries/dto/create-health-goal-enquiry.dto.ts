import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const HEALTH_GOAL_CONCERNS = [
  'mind-emotional-wellness',
  'thyroid',
  'liver',
  'gut',
  'fat-loss-metabolic',
  'skin',
] as const;

export class CreateHealthGoalEnquiryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(HEALTH_GOAL_CONCERNS.length)
  @IsIn(HEALTH_GOAL_CONCERNS, { each: true })
  concerns: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  goal: string;

  @IsString()
  @MinLength(3)
  @MaxLength(60)
  timeline: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  country: string;

  @IsOptional()
  @IsIn(['india', 'worldwide'])
  region?: 'india' | 'worldwide';

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(160)
  email: string;

  @IsString()
  @Matches(/^(?=.*\d)[0-9+()\-\s]{7,25}$/, {
    message: 'Phone number must include at least one digit and only common phone symbols',
  })
  phone: string;

  @IsBoolean()
  @Equals(true)
  consent: boolean;

  @IsIn(['homepage-health-goal-popup'])
  source: 'homepage-health-goal-popup';
}
