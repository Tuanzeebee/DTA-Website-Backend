/**
 * member-accounts.ts — cấp tài khoản Không gian số cho hội viên.
 *
 * Danh sách hội viên nằm ngay trong file này (MEMBERS bên dưới, lấy từ
 * "Đã rà soát_06_2026_DANH SÁCH HỘI VIÊN chính thức") — sửa trực tiếp rồi chạy:
 *
 *   npm run accounts:create              # CHẠY THỬ: chỉ in kế hoạch, không ghi DB
 *   npm run accounts:create -- --apply   # tạo tài khoản thật
 *
 * Mỗi mục: tạo User (role MEMBER, đăng nhập bằng email hoặc tài khoản) liên
 * kết với Member trong Danh bạ — gắn vào hội viên có sẵn (memberId, hoặc tên
 * trùng khớp) hoặc tạo hội viên mới. Chạy lại an toàn: mục đã có tài khoản bỏ
 * qua. Mọi tài khoản mới dùng chung mật khẩu DEFAULT_PASSWORD — nhắc hội viên
 * đổi ngay sau lần đăng nhập đầu (Không gian số › Hồ sơ › Đổi mật khẩu).
 * Danh sách tài khoản đã tạo ghi ra scripts/member-accounts/out/*.csv (gitignore).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { PrismaClient, RoleName } from '@prisma/client';

const DIR = path.join(__dirname, 'member-accounts');

/** Mật khẩu ban đầu chung cho mọi tài khoản mới — sửa ở đây nếu cần. */
const DEFAULT_PASSWORD = 'Dta@2026';

export interface AccountEntry {
  /** Số TT trong văn bản gốc — chỉ để đối chiếu. */
  tt: string;
  /** Tên hội viên (= Member.name, User.fullName). */
  name: string;
  /** Tài khoản đăng nhập: a-z, 0-9, . _ - (3–32 ký tự). */
  username: string;
  /** Email đăng nhập — bắt buộc, không trùng. */
  email: string;
  /**
   * Gắn vào hội viên có sẵn trong Danh bạ (id). Bỏ trống = tự tìm theo tên:
   * trùng khớp thì gắn, không có thì tạo mới, gần giống thì bỏ qua để chọn tay.
   * "new" = luôn tạo hội viên mới.
   */
  memberId?: string;
  /** true = bỏ qua mục này. */
  skip?: boolean;
  /** Thông tin Danh bạ — chỉ dùng khi phải TẠO hội viên mới. */
  member?: {
    address?: string;
    leader?: string;
    phone?: string;
    leaderEmail?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
  };
}

/* ------------------------------------------------------------------ *
 *  DANH SÁCH HỘI VIÊN — sửa ở đây                                     *
 * ------------------------------------------------------------------ */

export const MEMBERS: AccountEntry[] = [
  {
    tt: '01',
    name: 'Đại học Duy Tân',
    username: 'duytan',
    email: 'baole@duytan.edu.vn',
    member: {
      address: 'Số 03 Quang Trung, P. Thạch Thang, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'TS. Lê Nguyên Bảo',
      phone: '0903569338',
      leaderEmail: 'baole@duytan.edu.vn',
      contactName: 'Nguyễn Đức Mận',
    },
  },
  {
    tt: '02',
    name: 'Trường Đại học Đông Á',
    username: 'donga',
    email: 'chitp@donga.edu.vn',
    member: {
      address: 'Số 33 Xô Viết Nghệ Tĩnh, P. Hòa Cường Nam, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'TS. Nguyễn Thị Anh Đào – Hiệu trưởng.',
      phone: '0903515519',
      contactName: 'Trần Phương Chi',
      contactPhone: '0905432440',
      contactEmail: 'chitp@donga.edu.vn',
    },
  },
  {
    tt: '03',
    name: 'Công ty Cổ phần ENOUVO',
    username: 'enouvo',
    email: 'suong.ho@enouvo.com',
    member: {
      address: 'Số 16-18 An Nhơn 3, Phường An Hải Bắc, Quận Sơn Trà, TP. Đà Nẵng',
      leader: 'Ông Phạm Sĩ Nguyên',
      phone: '0909325878',
      leaderEmail: 'nguyen.pham@enouvo.com',
      contactName: 'Hồ Tuyết Sương',
      contactPhone: '0968214695',
      contactEmail: 'suong.ho@enouvo.com',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   Đầu mối liên hệ với Hiệp hội: Chị
  //   Nguyễn Quỳnh Như
  //   0935 485 829
  //   Thay đổi nhân sự:
  //   Hồ Nguyễn Quốc Hùng-Giám đốc (cũ)
  //   Cập nhật: Anh Vương Quang Hùng Phó Tổng giám đốc Rikkeisoft Phụ trách Khu vực Miền Trung - Giám đốc Rikkeisoft Chi nhánh Đà Nẵng (anh Hùng từ Nagoya Nhật trở về)
  {
    tt: '04',
    name: 'Công ty cổ phần Rikkeisoft – Chi nhánh Đà Nẵng',
    username: 'rikkeisoft',
    email: 'rikkeisoft@rikkeisoft.com',
    member: {
      address: 'Tầng 7 & 11, Tòa nhà Thông tấn xã Việt Nam, số 81 Quang Trung, P. Thạch Thang, Q. Hải Châu, TP. Đà Nẵng.',
      leader: 'Anh Vương Quang Hùng Phó Tổng giám đốc Rikkeisoft Phụ trách Khu vực Miền Trung - Giám đốc Rikkeisoft Chi nhánh Đà Nẵng (anh Hùng từ Nagoya Nhật trở về)',
      phone: '02363962685',
      contactName: 'Nguyễn Quỳnh Như',
      contactPhone: '0935485829',
    },
  },
  {
    tt: '05',
    name: 'Công Ty TNHH Phần mềm FPT Miền Trung',
    username: 'fptsoftware',
    email: 'phuongnt@fsoft.com.vn',
    member: {
      address: 'Tòa nhà FPT Complex đường Nam Kỳ Khởi nghĩa, P. Hòa Hải, Q Ngũ Hành Sơn, Đà Nẵng',
      leader: 'ông Nguyễn Tuấn Phương; ông Lê Hồng Lĩnh.',
      phone: '02363958777',
      contactName: 'Nguyễn Tuấn Phương',
      contactPhone: '0357676259',
      contactEmail: 'phuongnt@fsoft.com.vn',
    },
  },
  {
    tt: '06',
    name: 'Công ty cổ phần tư vấn DataHouse Asia',
    username: 'datahouse',
    email: 'asiabranding@datahouse.com',
    member: {
      address: '280-282 Nguyễn Hữu Thọ, Cẩm Lệ, Đà Nẵng',
      leader: 'Ông Nguyễn Văn Khoa – Giám đốc sản xuất phần mềm (CDO); ông Hoàng Trung Thắng – Giám đốc TT Phát triển phần mềm- CN Đà Nẵng 2; 0983949818',
      phone: '0983949818',
      contactName: 'Hằng Nguyễn',
      contactPhone: '0935630366',
    },
  },
  {
    tt: '07',
    name: 'Chi nhánh Công ty TNHH KMS Technology Việt Nam tại Đà Nẵng',
    username: 'kms',
    email: 'linhtmtran@kms-technology.com',
    member: {
      address: 'Tầng 5 - Tòa nhà VNPT, Số 346 đường 2/9, Phường Hoà Cường Bắc, Quận Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Nguyễn Văn Hiếu - Giám đốc (đã thôi chức, chuyển ra hải ngoại)',
      contactName: 'Trần Thị Mỹ Linh',
      contactPhone: '0706215649',
      contactEmail: 'linhtmtran@kms-technology.com',
    },
  },
  {
    tt: '08',
    name: 'Công ty Cổ phần Unitech',
    username: 'unitech',
    email: 'tienpm@unitech.vn',
    member: {
      address: 'Tầng 7, Công viên phần mềm, 2 Quang Trung, P. Thạch Thang, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Phan Minh Tiến',
      phone: '0903505151',
      leaderEmail: 'tienpm@unitech.vn',
      contactName: 'Sử Huy',
    },
  },
  {
    tt: '09',
    name: 'Công ty Cổ phần Công nghệ số thông minh',
    username: 'sdtech',
    email: 'dungtv@sdtech.vn',
    member: {
      address: 'Tầng 11, Tòa nhà Công viên phần mềm, số 02 đường Quang Trung, P. Thạch Thang, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Phạm Việt Trung',
      phone: '0914020831',
      leaderEmail: 'trungpv@sdtech.vn',
      contactName: 'Trần Văn Dũng',
      contactPhone: '0905123323',
      contactEmail: 'dungtv@sdtech.vn',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   Đại diện tổ chức hội viên giao dịch với Hiệp hội; đầu mối liên hệ: ông Trần Công Thành – Giám đốc điều hành(Ủy viên, Ban Kiểm tra, nhiệm kỳ 2017-2022; Trưởng ban Kiểm tra 2023-2028)
  //   Đại diện pháp luật:
  //   Bà Đào Thị Vĩnh
  {
    tt: '10',
    name: 'Công ty TNHH Tin học & TM ASNET',
    username: 'asnet',
    email: 'asnet@asnet.com',
    member: {
      address: 'Số 604 Núi Thành, P. Hòa Cường Nam, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Bà Đào Thị Vĩnh',
      contactName: 'Trần Công Thành',
    },
  },
  {
    tt: '11',
    name: 'Công ty TNHH Axon Active Việt Nam - CN Đà Nẵng',
    username: 'axonactive',
    email: 'hai.dang@axonactive.vn',
    member: {
      address: 'Tầng 11, Tòa nhà PVComBank, 214 đường 30 tháng 4, P. Hòa Cường, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Đặng Ngọc Hải - Giám đốc Chi nhánh',
      leaderEmail: 'hai.dang@axonactive.vn',
      contactName: 'Hà',
      contactPhone: '0906450690',
    },
  },
  {
    tt: '12',
    name: 'Khoa Công nghệ thông tin – trường Đại học Bách khoa, Đại học Đà Nẵng',
    username: 'cntt.dut',
    email: 'ntkhoi@dut.udn.vn',
    member: {
      address: '54 Nguyễn Lương Bằng, P. Hòa Khánh, Q. Liên Chiểu, TP. Đà Nẵng',
      leader: 'Quyền Trưởng khoa Khoa Công nghệ Thông tin, Trường Đại học Bách khoa – Đại học Đà Nẵng: PGS. TS. Phạm Công Thắng.',
      contactPhone: '0903511888',
      contactEmail: 'ntkhoi@dut.udn.vn',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   Tên cũ: Trung tâm Phát triển hạ tầng Công nghệ thông tin Đà Nẵng.
  //   Đầu mối liên hệ: Phạm Thế Nhân – Giám đốc
  //   0914317485
  //   Ông Trương Thanh Bình
  {
    tt: '13',
    name: 'Trung tâm Chuyển đổi số và Công nghệ chiến lược Đà Nẵng',
    username: 'ttcds',
    email: 'ttcds@da.na.vn',
    member: {
      address: 'Công viên Phần mềm Đà Nẵng, số 02 Quang Trung, P. Thạch Thang, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Trương Thanh Bình',
      contactName: 'Phạm Thế Nhân',
      contactPhone: '0914317485',
    },
  },
  {
    tt: '14',
    name: 'Trung tâm phát triển phần mềm Đại học Đà Nẵng',
    username: 'sdc.udn',
    email: 'congduy@gmail.com',
    member: {
      address: 'Tầng 5, khu C, Đại học Đà Nẵng, 41 Lê Duẩn, P. Hải Châu 1, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'TS Nguyễn Hà Huy Cường',
      phone: '0935019929',
      leaderEmail: 'congduy@gmail.com',
      contactName: 'Nguyễn Hà Huy Cường',
      contactPhone: '0935019929',
    },
  },
  {
    tt: '15',
    name: 'Công ty TNHH Đào Tạo và Công nghệ Iviettech',
    username: 'iviettech',
    email: 'contact@iviettech.vn',
    member: {
      address: 'Số 92 Quang Trung, P. Thạch Thang, Q. Hải Châu, TP Đà Nẵng',
      leader: 'Ông Vy Văn Việt –',
      phone: '0913146030',
      leaderEmail: 'vietvy@iviettech.vn',
      contactName: 'Nguyễn Thị Ngọc Lan',
      contactPhone: '0919850515',
      contactEmail: 'contact@iviettech.vn',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   Tiền thân (tên cũ) Trung tâm thông tin dịch vụ công Đà Nẵng (1022)
  //   Ông Nguyễn Văn Quốc – Giám đốc
  {
    tt: '16',
    name: 'Trung tâm giám sát, điều hành thông minh thành phố Đà Nẵng',
    username: 'ioc',
    email: 'ioc@da.na.vn',
    member: {
      address: 'Tầng 11, Tòa nhà CVPM, 02 Quang Trung, P. Thạch Thang, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Nguyễn Văn Quốc – Giám đốc',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   Tên cũ Công ty TNHH Hệ thống Thông tin FPT
  //   QĐ số 31, ngày 19/12/2023
  //   Đầu mối liên hệ: Anh Đinh Hồng Ân, 0914668445
  {
    tt: '17',
    name: 'Công ty TNHH FPT IS (FPT IS COMPANY LIMITED)',
    username: 'fptis',
    email: 'contact@fptis.com',
    member: {
      address: 'Tầng 8A, Tòa ICT1 - Công viên phần mềm 2, Khu Công Viên phần mềm số 2, Như Nguyệt, Thuận Phước, Phường Hải Châu, Thành phố Đà Nẵng',
      contactName: 'Đinh Hồng Ân',
      contactPhone: '0914668445',
    },
  },
  {
    tt: '18',
    name: 'Công ty TNHH Enosta',
    username: 'enosta',
    email: 'uyen.huynh@enosta.com',
    member: {
      address: '16-18 An Nhơn 3, An Hải Bắc, Sơn Trà, Đà Nẵng',
      leader: 'Chị Trần Hạnh Trang –',
      phone: '0826131212',
      leaderEmail: 'trang.tran@enosta.com',
      contactName: 'Huỳnh Thị Thục Uyên',
      contactPhone: '0935631890',
      contactEmail: 'uyen.huynh@enosta.com',
    },
  },
  {
    tt: '19',
    name: 'Công ty TNHH Thương mại và Công nghệ BITI',
    username: 'biti',
    email: 'bitihightech@gmail.com',
    member: {
      address: '156 Mẹ Thứ, P. Hòa Xuân, Q. Cẩm Lệ, Đà Nẵng',
      leader: 'Ông Nguyễn Bảo Nguyên – Giám đốc.',
      contactName: 'Nguyễn Bảo Nguyên',
      contactPhone: '0915531379',
      contactEmail: 'bitihightech@gmail.com',
    },
  },
  {
    tt: '20',
    name: 'Công ty TNHH CODECOMPLETE SOLUTIONS',
    username: 'codecomplete',
    email: 'khang.nguyen@codecomplete.jp',
    member: {
      address: 'Tầng 8, 81 Quang Trung, Phường Hải Châu I, Quận Hải Châu, Thành Phố Đà Nẵng',
      leader: 'Ông Saimon Saeki - chủ sở hữu (đại diện pháp nhân).',
      phone: '0913559593',
      contactName: 'Nguyễn Thái Khang',
      contactPhone: '0906265606',
      contactEmail: 'khang.nguyen@codecomplete.jp',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   QĐ số 35, ngày 11/01/2024.
  //   Đầu mối liên hệ: Anh Nguyễn Hoài Đức (hoặc chị Võ Thị Kim Nga)
  //   1.Nguyễn Hoài Đức – Chủ tịch HĐQT (đại diện pháp nhân), 0905. 496 099
  //   2. Vũ Tú Anh – Giám đốc, 0945.484 299
  {
    tt: '21',
    name: 'Công ty cổ phần Giải pháp Công nghệ DANATEQ',
    username: 'danateq',
    email: 'contact@danateq.com',
    member: {
      address: 'Số 26 đường Dương Trí Trạch, phường An Hải bắc, quận Sơn Trà, Đà Nẵng',
      leader: '1.Nguyễn Hoài Đức – Chủ tịch HĐQT (đại diện pháp nhân), 0905. 496 099',
      phone: '0945484299',
      contactName: 'Nguyễn Hoài Đức',
    },
  },
  {
    tt: '22',
    name: 'Công ty TNHH FPT Smart Cloud',
    username: 'fptsmartcloud',
    email: 'huynh60@fpt.com',
    member: {
      address: 'Số 10 Phạm Văn Bạch, phường Cầu Giấy, Hà Nội',
      leader: 'Ông Lê Hồng Việt',
      contactName: 'Nguyễn Hoàng Huy',
      contactPhone: '0708555520',
      contactEmail: 'huynh60@fpt.com',
    },
  },
  {
    tt: '23',
    name: 'Công ty Tư vấn giải pháp CNTT Toàn Cầu Xanh',
    username: 'greenglobal',
    email: 'contact@toancauxanh.vn',
    member: {
      address: 'Số 31 Trần Phú, P. Hải Châu 1, Q. Hải Châu, TP. Đà Nẵng',
      leader: 'Ông Lê Trí Hải',
      phone: '02363833666',
      leaderEmail: 'contact@toancauxanh.vn',
    },
  },
  // TODO: văn bản gốc không có email — điền email hoặc đặt skip: true.
  //   QĐ số 36, ngày 09/06/2024.
  //   Đầu mối liên hệ: anh Trần Lộc 0962 868 643
  //   Ông Phạm Đức Minh – Giám đốc, số điện thoại 03833965060
  {
    tt: '24',
    name: 'Công ty TNHH CÔNG NGHỆ SAPOTA CORP',
    username: 'sapota',
    email: 'contact@sapota.vn',
    member: {
      address: 'Số 101, đường Huỳnh Tấn Phát, phường Hòa Cường Bắc, quận Hải Châu, Đà Nẵng',
      leader: 'Ông Phạm Đức Minh – Giám đốc, số điện thoại 03833965060',
      phone: '03833965060',
      contactName: 'Trần Lộc',
      contactPhone: '0962868643',
    },
  },
];

/* ------------------------------------------------------------------ */

/** Bỏ dấu tiếng Việt, chữ thường. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Từ pháp lý/chung chung — bỏ khi so tên với Danh bạ. */
const NOISE =
  /\b(cong ty|co phan|tnhh|trach nhiem huu han|chi nhanh|tai da nang|thanh pho|tp|da nang|viet nam|mien trung|thuong mai|va|company limited)\b/g;

/** Tên đã chuẩn hoá để so khớp hội viên có sẵn. */
export function nameKey(name: string): string {
  return fold(name)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_ONLY_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lỗi dữ liệu trong danh sách (trước khi đụng DB). */
export function validateEntries(entries: AccountEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const e of entries.filter((x) => !x.skip)) {
    const tag = `[TT ${e.tt}] ${e.name}`;
    if (!e.name?.trim()) errors.push(`${tag}: thiếu tên`);
    if (!USERNAME_RE.test(e.username ?? '')) errors.push(`${tag}: tài khoản "${e.username}" không hợp lệ (a-z 0-9 . _ -, 3–32 ký tự)`);
    if (!EMAIL_ONLY_RE.test(e.email ?? '')) errors.push(`${tag}: thiếu/sai email đăng nhập "${e.email ?? ''}"`);
    for (const key of [`u:${e.username}`, `e:${e.email?.toLowerCase()}`].filter((k) => k.length > 2)) {
      if (seen.has(key)) errors.push(`${tag}: trùng ${key.slice(2)} với ${seen.get(key)}`);
      else seen.set(key, tag);
    }
  }
  return errors;
}

export async function create(entries: AccountEntry[], apply: boolean) {
  const errors = validateEntries(entries);
  if (errors.length) {
    console.error(`Danh sách có ${errors.length} lỗi — sửa MEMBERS rồi chạy lại:\n  ` + errors.join('\n  '));
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const role = await prisma.role.findUnique({ where: { name: RoleName.MEMBER } });
    if (!role) throw new Error('Chưa seed roles. Chạy: npm run seed:rbac');
    const members = await prisma.member.findMany({ include: { user: { select: { id: true } } } });

    const creds: string[][] = [];
    const counts = { created: 0, linked: 0, skipped: 0 };
    console.log(apply ? '== TẠO TÀI KHOẢN ==' : '== CHẠY THỬ (thêm --apply để ghi DB) ==');

    for (const e of entries) {
      const tag = `[TT ${e.tt}] ${e.name}`;
      const skip = (why: string) => {
        counts.skipped += 1;
        console.log(`  bỏ qua  ${tag}: ${why}`);
      };
      if (e.skip) {
        skip('skip = true');
        continue;
      }
      const email = e.email.trim().toLowerCase();
      const clash = await prisma.user.findFirst({
        where: { OR: [{ email }, { username: e.username }] },
        select: { email: true, username: true },
      });
      if (clash) {
        skip(`đã có tài khoản ${clash.username ?? ''} <${clash.email}>`);
        continue;
      }

      const forceNew = e.memberId === 'new';
      let member = e.memberId && !forceNew ? members.find((m) => m.id === e.memberId) : undefined;
      if (e.memberId && !forceNew && !member) {
        skip(`memberId ${e.memberId} không tồn tại`);
        continue;
      }
      if (!member && !forceNew) {
        const key = nameKey(e.name);
        const same = members.filter((m) => nameKey(m.name) === key);
        if (same.length > 1) {
          skip(`trùng tên với ${same.length} hội viên — điền memberId`);
          continue;
        }
        member = same[0];
        // Tên gần giống (chứa nhau) → không tự tạo trùng trong Danh bạ, để người chạy chọn.
        const near = member
          ? []
          : members.filter((m) => {
              const k = nameKey(m.name);
              return k.length > 2 && key.length > 2 && (k.includes(key) || key.includes(k));
            });
        if (near.length) {
          skip(
            `tên gần giống hội viên có sẵn: ${near.map((m) => `"${m.name}" (memberId ${m.id})`).join(', ')} — điền memberId đó, hoặc "new" để tạo mới`,
          );
          continue;
        }
      }
      if (member?.user) {
        skip(`hội viên "${member.name}" đã có tài khoản`);
        continue;
      }

      const action = member ? `gắn vào hội viên có sẵn "${member.name}"` : 'TẠO hội viên mới';
      console.log(`  ${apply ? 'tạo' : 'sẽ tạo'}  ${tag} → ${e.username} <${email}> · ${action}`);
      if (member) counts.linked += 1;
      else counts.created += 1;
      if (!apply) continue;

      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      const existingId = member?.id;
      await prisma.$transaction(async (tx) => {
        const memberId =
          existingId ??
          (
            await tx.member.create({
              data: {
                name: e.name.trim(),
                role: 'Hội viên Tổ chức',
                type: 'organization',
                ...Object.fromEntries(
                  Object.entries(e.member ?? {}).map(([k, v]) => [k, v?.trim() || null]),
                ),
              },
            })
          ).id;
        await tx.user.create({
          data: {
            email,
            username: e.username,
            passwordHash,
            fullName: e.name.trim(),
            memberId,
            roles: { create: [{ roleId: role.id }] },
          },
        });
      });
      creds.push([e.tt, e.name, e.username, email, DEFAULT_PASSWORD]);
    }

    console.log(
      `\nTổng: ${counts.linked} gắn hội viên có sẵn, ${counts.created} tạo hội viên mới, ${counts.skipped} bỏ qua.`,
    );
    if (creds.length) {
      const out = path.join(DIR, 'out', `tai-khoan-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const csv = [['TT', 'Hội viên', 'Tài khoản', 'Email', 'Mật khẩu ban đầu'], ...creds]
        .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      fs.writeFileSync(out, '\uFEFF' + csv); // BOM để Excel đọc đúng tiếng Việt
      console.log(
        `Danh sách tài khoản: ${out}\n→ Mật khẩu ban đầu: ${DEFAULT_PASSWORD} — nhắc từng đơn vị đổi mật khẩu ngay khi đăng nhập.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  create(MEMBERS, process.argv.includes('--apply')).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
