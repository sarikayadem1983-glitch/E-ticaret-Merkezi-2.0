import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CompanyRoleDto } from '../invitations/invitations.dto.js';

/**
 * Replaces a member's whole access: `{ tenantRole: 'admin' }` or
 * `{ companyRoles: [...] }` (exactly one; checked in the service, like an
 * invitation). Owner is never assignable.
 */
export class UpdateAccessDto {
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
