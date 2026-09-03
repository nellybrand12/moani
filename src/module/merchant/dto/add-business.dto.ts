import {
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Starter set of business types covering common informal and formal
 * categories relevant to Cameroon's informal commerce sector.
 */
enum BusinessTypeDto {
  RETAIL = 'RETAIL',
  SALON_BARBERSHOP = 'SALON_BARBERSHOP',
  RESTAURANT_FOOD = 'RESTAURANT_FOOD',
  SERVICES = 'SERVICES',
  TRANSPORT = 'TRANSPORT',
  WHOLESALE = 'WHOLESALE',
  OTHER = 'OTHER',
}

/**
 * AddBusinessDto — Tier 1 fields only.
 *
 * No registrationNumber, registrationDocumentUrl, or taxId — those
 * are Tier 2 fields added later via a separate upgrade endpoint.
 */
export class AddBusinessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  businessName: string;

  @IsEnum(BusinessTypeDto)
  businessType: BusinessTypeDto;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  address: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @IsOptional()
  @IsPhoneNumber('CM')
  businessPhone?: string;
}
