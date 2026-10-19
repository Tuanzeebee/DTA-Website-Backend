import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/** Vị trí có giao diện hiển thị trên trang tin (đồng bộ AdSlot ở frontend). */
export const AD_SLOTS = ['banner', 'sidebar'] as const;

export class CreateAdDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsIn(AD_SLOTS)
  slot?: string;

  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

  @IsString()
  @IsNotEmpty()
  linkUrl!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateAdDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsIn(AD_SLOTS)
  slot?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
