import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @IsString()
  @Length(2, 100)
  tenantName: string;

  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'tenantSlug küçük harf, rakam ve tire içerebilir',
  })
  @Length(3, 50)
  tenantSlug: string;

  @IsString()
  @Length(2, 100)
  name: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}
