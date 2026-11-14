import 'dotenv/config';
import { PrismaClient, RoleName, EventStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

const permissions = [
  { code: 'event.view_public', description: 'Melihat event publik' },
  { code: 'event.create', description: 'Membuat event' },
  { code: 'event.update', description: 'Mengubah event' },
  { code: 'event.delete', description: 'Menghapus (soft) event' },
  { code: 'ticket_category.manage', description: 'Mengelola kategori tiket' },
  { code: 'voucher.manage', description: 'Mengelola voucher' },
  { code: 'order.create', description: 'Membuat order' },
  { code: 'order.view_own', description: 'Melihat order milik sendiri' },
  { code: 'order.view_event', description: 'Melihat order pada event sendiri' },
  { code: 'order.view_all', description: 'Melihat seluruh order (monitoring)' },
  { code: 'ticket.view_own', description: 'Melihat tiket milik sendiri' },
  { code: 'ticket.scan', description: 'Scan dan validasi tiket' },
  { code: 'point.use', description: 'Menukar poin' },
  { code: 'user.manage', description: 'Mengelola user' },
  { code: 'role.manage', description: 'Mengelola role' },
  { code: 'permission.manage', description: 'Mengelola permission' },
  { code: 'report.view_all', description: 'Melihat seluruh laporan' },
  { code: 'report.view_event', description: 'Melihat laporan event sendiri' },
  { code: 'audit_log.view', description: 'Melihat audit log' },
] as const;

type PermissionCode = (typeof permissions)[number]['code'];

const rolePermissions: Record<RoleName, readonly PermissionCode[]> = {
  [RoleName.SUPER_ADMIN]: [
    'event.view_public',
    'event.create',
    'event.update',
    'event.delete',
    'ticket_category.manage',
    'voucher.manage',
    'order.create',
    'order.view_own',
    'order.view_event',
    'order.view_all',
    'ticket.view_own',
    'user.manage',
    'role.manage',
    'permission.manage',
    'report.view_all',
    'report.view_event',
    'audit_log.view',
  ],
  [RoleName.EVENT_MANAGER]: [
    'event.view_public',
    'event.create',
    'event.update',
    'event.delete',
    'ticket_category.manage',
    'voucher.manage',
    'order.create',
    'order.view_own',
    'order.view_event',
    'ticket.view_own',
    'report.view_event',
  ],
  [RoleName.GATE_OFFICER]: [
    'event.view_public',
    'order.create',
    'order.view_own',
    'ticket.view_own',
    'ticket.scan',
  ],
  [RoleName.CUSTOMER]: [
    'event.view_public',
    'order.create',
    'order.view_own',
    'ticket.view_own',
    'point.use',
  ],
};

const roleDescriptions: Record<RoleName, string> = {
  [RoleName.SUPER_ADMIN]: 'Mengelola user, role, permission, dan memonitor seluruh sistem',
  [RoleName.EVENT_MANAGER]: 'Mengelola event, kategori tiket, dan voucher miliknya',
  [RoleName.GATE_OFFICER]: 'Scan QR dan validasi tiket pada event yang ditugaskan',
  [RoleName.CUSTOMER]: 'Member yang membeli tiket dan mengumpulkan poin',
};

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Environment variable ${name} wajib diisi. Tambahkan ke backend/.env sebelum menjalankan seed.`,
    );
  }
  return value;
};

const addDays = (base: Date, days: number): Date =>
  new Date(base.getTime() + days * DAY_MS);

const main = async () => {
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD');
  const demoPassword = requireEnv('SEED_DEMO_PASSWORD');
  const now = new Date();

  const roles = new Map<RoleName, { id: number }>();

  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description: roleDescriptions[name] },
      create: { name, description: roleDescriptions[name] },
    });
    roles.set(name, role);
  }

  const permissionsByCode = new Map<string, { id: number }>();

  for (const permission of permissions) {
    const row = await prisma.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description },
      create: permission,
    });
    permissionsByCode.set(row.code, row);
  }

  for (const name of Object.values(RoleName)) {
    const role = roles.get(name);
    if (!role) throw new Error(`Role ${name} tidak ditemukan`);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    const data = rolePermissions[name].map((code) => {
      const permission = permissionsByCode.get(code);
      if (!permission) throw new Error(`Permission ${code} tidak ditemukan`);
      return { roleId: role.id, permissionId: permission.id };
    });

    await prisma.rolePermission.createMany({ data, skipDuplicates: true });
  }

  const [adminHash, demoHash] = await Promise.all([
    bcrypt.hash(adminPassword, 12),
    bcrypt.hash(demoPassword, 12),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@eventtixx.com' },
    update: {
      name: 'Super Admin',
      roleId: roles.get(RoleName.SUPER_ADMIN)!.id,
      passwordHash: adminHash,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
    create: {
      name: 'Super Admin',
      email: 'admin@eventtixx.com',
      phone: '081100000001',
      passwordHash: adminHash,
      roleId: roles.get(RoleName.SUPER_ADMIN)!.id,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: 'manager@eventtixx.com' },
    update: {
      name: 'Event Manager Demo',
      roleId: roles.get(RoleName.EVENT_MANAGER)!.id,
      passwordHash: demoHash,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
    create: {
      name: 'Event Manager Demo',
      email: 'manager@eventtixx.com',
      phone: '081100000002',
      passwordHash: demoHash,
      roleId: roles.get(RoleName.EVENT_MANAGER)!.id,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
  });

  const gate = await prisma.user.upsert({
    where: { email: 'gate@eventtixx.com' },
    update: {
      name: 'Gate Officer Demo',
      roleId: roles.get(RoleName.GATE_OFFICER)!.id,
      passwordHash: demoHash,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
    create: {
      name: 'Gate Officer Demo',
      email: 'gate@eventtixx.com',
      phone: '081100000003',
      passwordHash: demoHash,
      roleId: roles.get(RoleName.GATE_OFFICER)!.id,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@eventtixx.com' },
    update: {
      name: 'Customer Demo',
      roleId: roles.get(RoleName.CUSTOMER)!.id,
      passwordHash: demoHash,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
    create: {
      name: 'Customer Demo',
      email: 'customer@eventtixx.com',
      phone: '081100000004',
      passwordHash: demoHash,
      roleId: roles.get(RoleName.CUSTOMER)!.id,
      status: 'ACTIVE',
      emailVerifiedAt: now,
    },
  });

  const neonStart = addDays(now, 90);
  const sunsetStart = addDays(now, 150);

  const neonEvent = await prisma.event.upsert({
    where: { slug: 'neon-horizon-music-festival-2027' },
    update: {
      title: 'Neon Horizon Music Festival 2027',
      description:
        'Festival musik dua hari dengan lineup elektronik, pop, dan rock lokal maupun internasional.',
      posterUrl: 'https://placehold.co/1200x630/png?text=Neon+Horizon',
      venueName: 'Gelora Bung Karno',
      venueAddress: 'Jl. Pintu Satu Senayan, Jakarta Pusat',
      city: 'Jakarta',
      startAt: neonStart,
      endAt: addDays(now, 91),
      status: EventStatus.PUBLISHED,
      deletedAt: null,
    },
    create: {
      createdById: manager.id,
      title: 'Neon Horizon Music Festival 2027',
      slug: 'neon-horizon-music-festival-2027',
      description:
        'Festival musik dua hari dengan lineup elektronik, pop, dan rock lokal maupun internasional.',
      posterUrl: 'https://placehold.co/1200x630/png?text=Neon+Horizon',
      venueName: 'Gelora Bung Karno',
      venueAddress: 'Jl. Pintu Satu Senayan, Jakarta Pusat',
      city: 'Jakarta',
      startAt: neonStart,
      endAt: addDays(now, 91),
      status: EventStatus.PUBLISHED,
    },
  });

  const sunsetEvent = await prisma.event.upsert({
    where: { slug: 'sunset-acoustic-night-2027' },
    update: {
      title: 'Sunset Acoustic Night 2027',
      description:
        'Malam akustik intim bersama musisi folk dan indie pilihan di Bandung.',
      posterUrl: 'https://placehold.co/1200x630/png?text=Sunset+Acoustic',
      venueName: 'Sabuga ITB',
      venueAddress: 'Jl. Tamansari No. 73, Bandung',
      city: 'Bandung',
      startAt: sunsetStart,
      endAt: null,
      status: EventStatus.PUBLISHED,
      deletedAt: null,
    },
    create: {
      createdById: manager.id,
      title: 'Sunset Acoustic Night 2027',
      slug: 'sunset-acoustic-night-2027',
      description:
        'Malam akustik intim bersama musisi folk dan indie pilihan di Bandung.',
      posterUrl: 'https://placehold.co/1200x630/png?text=Sunset+Acoustic',
      venueName: 'Sabuga ITB',
      venueAddress: 'Jl. Tamansari No. 73, Bandung',
      city: 'Bandung',
      startAt: sunsetStart,
      status: EventStatus.PUBLISHED,
    },
  });

  const demoCategories = [
    {
      eventId: neonEvent.id,
      name: 'Festival Pass',
      description: 'Akses seluruh area festival selama dua hari.',
      price: 750_000,
      quota: 500,
      maxPerOrder: 4,
      saleStartAt: addDays(now, -7),
      saleEndAt: neonStart,
    },
    {
      eventId: neonEvent.id,
      name: 'VIP Front Row',
      description: 'Area VIP di depan panggung plus merchandise eksklusif.',
      price: 1_500_000,
      quota: 100,
      maxPerOrder: 2,
      saleStartAt: addDays(now, -7),
      saleEndAt: neonStart,
    },
    {
      eventId: sunsetEvent.id,
      name: 'Regular',
      description: 'Tiket masuk reguler Sunset Acoustic Night.',
      price: 250_000,
      quota: 200,
      maxPerOrder: 4,
      saleStartAt: addDays(now, -7),
      saleEndAt: sunsetStart,
    },
  ];

  for (const category of demoCategories) {
    const existing = await prisma.ticketCategory.findFirst({
      where: { eventId: category.eventId, name: category.name },
    });

    if (existing) {
      await prisma.ticketCategory.update({
        where: { id: existing.id },
        data: {
          description: category.description,
          price: category.price,
          quota: category.quota,
          maxPerOrder: category.maxPerOrder,
          saleStartAt: category.saleStartAt,
          saleEndAt: category.saleEndAt,
          isActive: true,
        },
      });
    } else {
      await prisma.ticketCategory.create({ data: category });
    }
  }

  await prisma.eventStaff.upsert({
    where: { eventId_userId: { eventId: neonEvent.id, userId: gate.id } },
    update: {},
    create: { eventId: neonEvent.id, userId: gate.id },
  });

  const [roleCount, permissionCount, userCount, eventCount, categoryCount] =
    await Promise.all([
      prisma.role.count(),
      prisma.permission.count(),
      prisma.user.count(),
      prisma.event.count(),
      prisma.ticketCategory.count(),
    ]);

  console.log('Seed selesai:');
  console.log(`  roles: ${roleCount}`);
  console.log(`  permissions: ${permissionCount}`);
  console.log(`  users: ${userCount} (admin: ${admin.email}, manager: ${manager.email})`);
  console.log(`  events: ${eventCount}`);
  console.log(`  ticket categories: ${categoryCount}`);
  console.log(`  gate officer ${gate.email} ditugaskan ke event "${neonEvent.title}"`);
  console.log(`  customer demo: ${customer.email}`);
};

main()
  .catch((error) => {
    console.error('Seed gagal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
