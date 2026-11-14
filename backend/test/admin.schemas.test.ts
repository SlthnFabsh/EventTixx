import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminOrdersQuerySchema,
  auditLogsQuerySchema,
  createPermissionSchema,
  updatePermissionSchema,
  updateRoleSchema,
} from '../src/modules/admin/admin.schemas';

test('admin order filters parse pagination and reject reversed date ranges', () => {
  const parsed = adminOrdersQuerySchema.parse({
    page: '2',
    limit: '50',
    status: 'PAID',
    from: '2026-11-01',
    to: '2026-11-30',
  });
  assert.equal(parsed.page, 2);
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.status, 'PAID');
  assert.throws(() =>
    adminOrdersQuerySchema.parse({
      from: '2026-11-30',
      to: '2026-11-01',
    }),
  );
  assert.throws(() =>
    adminOrdersQuerySchema.parse({ page: '1', limit: '101' }),
  );
});

test('admin audit date range and permission mutations are validated', () => {
  assert.throws(() =>
    auditLogsQuerySchema.parse({
      from: '2026-11-30',
      to: '2026-11-01',
    }),
  );
  assert.equal(
    createPermissionSchema.parse({
      code: 'report.export',
      description: 'Export report',
    }).code,
    'report.export',
  );
  assert.throws(() => createPermissionSchema.parse({ code: 'Bad Code' }));
  assert.throws(() => updatePermissionSchema.parse({}));
  assert.throws(() =>
    updateRoleSchema.parse({ permissionCodes: ['user.manage', 'user.manage'] }),
  );
});
