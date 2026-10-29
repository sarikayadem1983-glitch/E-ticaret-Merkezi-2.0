import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Roles an invitation can carry. Owner is never invitable. */
export const INVITABLE_COMPANY_ROLES = [
  'operations',
  'accounting',
  'viewer',
] as const;
export type InvitableCompanyRole = (typeof INVITABLE_COMPANY_ROLES)[number];

export class CompanyRoleDto {
  @IsUUID()
  companyId: string;

  @IsIn(INVITABLE_COMPANY_ROLES)
  roleKey: InvitableCompanyRole;
}

/** `{ email, tenantRole: 'admin' }` or `{ email, companyRoles: [...] }`; checked in the service. */
export class CreateInvitationDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsIn(['admin'])
  tenantRole?: 'admin';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CompanyRoleDto)
  companyRoles?: CompanyRoleDto[];
}

/** base64url of 32 bytes. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class InvitationTokenDto {
  @IsString()
  @Matches(TOKEN, { message: 'token geçersiz' })
  token: string;
}

export class AcceptInvitationDto extends InvitationTokenDto {
  /** Only for a new account (2–100 characters); ignored otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  /** New account: 8–128 characters. Existing account: its current password. */
  @IsString()
  @MaxLength(128)
  password: string;
}
