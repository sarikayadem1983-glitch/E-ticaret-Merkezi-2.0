import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { CHANNEL_DEFINITIONS } from './channel-adapter.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CHANNEL_CODES = CHANNEL_DEFINITIONS.map((d) => d.code);

export class CreateChannelAccountDto {
  @IsIn(CHANNEL_CODES, { message: 'Desteklenmeyen kanal' })
  channel!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name!: string;

  /** Field values per the channel definition; validated in the service. */
  @IsObject()
  credentials!: Record<string, unknown>;
}

export class UpdateChannelAccountDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Replaces all credentials when present (no partial update of secrets). */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;
}
