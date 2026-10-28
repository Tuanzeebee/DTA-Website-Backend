import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Tài khoản: 3–32 ký tự a-z, 0-9, dấu chấm, gạch dưới, gạch ngang. */
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const USERNAME_MSG =
  'Tài khoản chỉ gồm 3–32 ký tự a-z, 0-9, dấu chấm, gạch dưới, gạch ngang';
import { RoleName, UserStatus } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsArray()
  @IsEnum(RoleName, { each: true })
  roles?: RoleName[];

  @IsOptional()
  @Matches(USERNAME_RE, { message: USERNAME_MSG })
  username?: string;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

export class SetUsernameDto {
  /** null = gỡ tài khoản, chỉ còn đăng nhập bằng email. */
  @ValidateIf((_o, v) => v !== null)
  @Matches(USERNAME_RE, { message: USERNAME_MSG })
  username!: string | null;
}

export class SetRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(RoleName, { each: true })
  roles!: RoleName[];
}

export class SetStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
