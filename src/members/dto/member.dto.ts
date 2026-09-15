import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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
  strengths?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
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
  strengths?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
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
  strengths?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  website?: string;
}
