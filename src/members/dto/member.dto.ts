import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/** "www.abc.com" -> "https://www.abc.com" — thiếu scheme thì link thành đường dẫn tương đối (404). */
export const withScheme = (v: unknown) =>
  typeof v === 'string' && v.trim() && !/^[a-z][a-z\d+.-]*:/i.test(v.trim())
    ? `https://${v.trim()}`
    : v;

export class CreateMemberDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsEnum(['organization', 'individual', 'advisory'])
  type?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEnum(['domestic', 'fdi'])
  ownership?: string;

  @IsOptional()
  @IsString()
  leader?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  leaderEmail?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  strengths?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => withScheme(value))
  website?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsEnum(['organization', 'individual', 'advisory'])
  type?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEnum(['domestic', 'fdi'])
  ownership?: string;

  @IsOptional()
  @IsString()
  leader?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  leaderEmail?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  strengths?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => withScheme(value))
  website?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

/**
 * Hội viên tự sửa hồ sơ của chính mình — chỉ các trường được phép,
 * không gồm role / type / sortOrder.
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEnum(['domestic', 'fdi'])
  ownership?: string;

  @IsOptional()
  @IsString()
  leader?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  leaderEmail?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  strengths?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => withScheme(value))
  website?: string;
}
