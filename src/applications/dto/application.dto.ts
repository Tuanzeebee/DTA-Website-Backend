import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SubmitApplicationDto {
  @IsString()
  @IsNotEmpty()
  orgName!: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsEnum(['domestic', 'fdi'])
  ownership?: string;

  @IsOptional()
  @IsString()
  leader?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(['organization', 'individual'])
  type?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  strengths?: string;

  @IsOptional()
  @IsString()
  techField?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
