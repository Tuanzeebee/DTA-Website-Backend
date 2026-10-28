import { RoleName } from '@prisma/client';

export enum Permission {
  ARTICLE_CREATE = 'article:create',
  ARTICLE_UPDATE_OWN = 'article:update-own',
  ARTICLE_UPDATE_ANY = 'article:update-any',
  ARTICLE_DELETE_OWN = 'article:delete-own',
  ARTICLE_DELETE_ANY = 'article:delete-any',
  ARTICLE_PUBLISH = 'article:publish',
  CATEGORY_MANAGE = 'category:manage',
  TOPIC_MANAGE = 'topic:manage',
  USER_READ = 'user:read',
  USER_MANAGE = 'user:manage',
  MEMBER_CONTENT_READ = 'member-content:read',
}

const ALL_PERMISSIONS = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.SUPER_ADMIN]: ALL_PERMISSIONS,
  [RoleName.ADMIN]: [
    Permission.ARTICLE_CREATE,
    Permission.ARTICLE_UPDATE_OWN,
    Permission.ARTICLE_UPDATE_ANY,
    Permission.ARTICLE_DELETE_OWN,
    Permission.ARTICLE_DELETE_ANY,
    Permission.ARTICLE_PUBLISH,
    Permission.CATEGORY_MANAGE,
    Permission.TOPIC_MANAGE,
    Permission.USER_READ,
  ],
  [RoleName.EDITOR]: [
    Permission.ARTICLE_CREATE,
    Permission.ARTICLE_UPDATE_OWN,
    Permission.ARTICLE_UPDATE_ANY,
    Permission.ARTICLE_DELETE_OWN,
    Permission.ARTICLE_PUBLISH,
  ],
  [RoleName.AUTHOR]: [
    Permission.ARTICLE_CREATE,
    Permission.ARTICLE_UPDATE_OWN,
    Permission.ARTICLE_DELETE_OWN,
  ],
  [RoleName.MEMBER]: [
    Permission.MEMBER_CONTENT_READ,
    Permission.ARTICLE_CREATE,
    Permission.ARTICLE_UPDATE_OWN,
    Permission.ARTICLE_DELETE_OWN,
  ],
  [RoleName.USER]: [],
};

export function roleHasPermission(
  role: RoleName,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export interface AuthUser {
  id: string;
  email: string;
  roles: RoleName[];
}

export function hasPermission(user: AuthUser, permission: Permission): boolean {
  return user.roles.some((role) => roleHasPermission(role, permission));
}

/** Main Topic duy nhất hội viên được đăng bài (góp ý 27/10/2026). */
export const MEMBER_TOPIC_SLUG = 'hoi-vien';

/** Tài khoản chỉ mang quyền hội viên — không kèm vai trò biên tập/quản trị. */
export function isMemberOnly(user: AuthUser): boolean {
  return user.roles.every(
    (role) => role === RoleName.MEMBER || role === RoleName.USER,
  );
}
