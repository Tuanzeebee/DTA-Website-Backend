import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** Email đơn vị hoặc Tài khoản do Hiệp hội cấp. Giữ tên `email` để client cũ không vỡ. */
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}
