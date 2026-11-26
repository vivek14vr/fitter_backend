import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateContactEnquiryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lastName: string;

  @IsEmail()
  @MaxLength(160)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+()\-\s]{7,25}$/, {
    message: 'WhatsApp number must include only digits and common phone symbols',
  })
  whatsapp?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;

  @IsBoolean()
  @Equals(true)
  consent: boolean;
}
