/// <reference types="jest" />
import { MEMBERS, nameKey, validateEntries, type AccountEntry } from './member-accounts';

const entry = (over: Partial<AccountEntry>): AccountEntry => ({
  tt: '1',
  name: 'Công ty A',
  username: 'cty-a',
  email: 'a@a.vn',
  ...over,
});

describe('member-accounts', () => {
  it('so tên bỏ dấu & từ pháp lý', () => {
    expect(nameKey('Công ty TNHH Enosta')).toBe(nameKey('ENOSTA'));
  });

  it('báo lỗi thiếu email, tài khoản sai, trùng; bỏ qua mục skip', () => {
    const errors = validateEntries([
      entry({ tt: '1' }),
      entry({ tt: '2', email: 'A@a.vn', username: 'x y' }),
      entry({ tt: '3', email: '', username: 'c' }),
      entry({ tt: '4', email: '', skip: true }),
    ]);
    expect(errors).toEqual([
      expect.stringContaining('[TT 2] Công ty A: tài khoản "x y"'),
      expect.stringContaining('[TT 2] Công ty A: trùng a@a.vn'),
      expect.stringContaining('[TT 3] Công ty A: tài khoản "c"'),
      expect.stringContaining('[TT 3] Công ty A: thiếu/sai email'),
    ]);
  });

  it('MEMBERS: ngoài các mục còn thiếu email, không có lỗi nào khác', () => {
    const errors = validateEntries(MEMBERS).filter((e) => !e.endsWith('email đăng nhập ""'));
    expect(errors).toEqual([]);
  });
});
