import { randomBytes } from 'crypto';

/** Mật khẩu tạm 12 ký tự, chỉ trả về 1 lần lúc cấp/cấp lại. */
export function newTempPassword(): string {
  return randomBytes(9).toString('base64url').slice(0, 12);
}
