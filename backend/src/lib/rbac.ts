import { prisma } from './prisma';

// Cache roleId -> Set<permissionCode>
const cache = new Map<number, Set<string>>();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

export const invalidateRbacCache = (): void => {
  cache.clear();
  cacheLoadedAt = 0;
};

export const loadRbacCache = async (force = false): Promise<void> => {
  const now = Date.now();
  if (!force && cache.size > 0 && now - cacheLoadedAt < CACHE_TTL_MS) {
    return;
  }

  const rolePermissions = await prisma.rolePermission.findMany({
    select: {
      roleId: true,
      permission: { select: { code: true } },
    },
  });

  const nextCache = new Map<number, Set<string>>();
  for (const rp of rolePermissions) {
    let set = nextCache.get(rp.roleId);
    if (!set) {
      set = new Set<string>();
      nextCache.set(rp.roleId, set);
    }
    set.add(rp.permission.code);
  }

  cache.clear();
  for (const [roleId, set] of nextCache.entries()) {
    cache.set(roleId, set);
  }
  cacheLoadedAt = now;
};

export const hasPermission = async (
  roleId: number,
  permissionCode: string,
): Promise<boolean> => {
  await loadRbacCache();
  const set = cache.get(roleId);
  return set ? set.has(permissionCode) : false;
};

export const getRolePermissions = async (
  roleId: number,
): Promise<string[]> => {
  await loadRbacCache();
  const set = cache.get(roleId);
  return set ? Array.from(set) : [];
};
