import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoleName, UserStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { eventsService } from '../src/modules/events/events.service';
import { AppError } from '../src/utils/app-error';
import type { AuthenticatedUser } from '../src/types/auth';

const manager: AuthenticatedUser = {
  id: 'manager-id',
  roleId: 2,
  role: RoleName.EVENT_MANAGER,
  email: 'manager@example.com',
  name: 'Manager',
  phone: null,
  status: UserStatus.ACTIVE,
  pointBalance: 0,
};

const eventId = '00000000-0000-4000-8000-000000000001';
const categoryId = '00000000-0000-4000-8000-000000000002';

const replaceMethod = (
  target: object,
  name: string,
  value: (...args: unknown[]) => unknown,
): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  };
};

test('event manager cannot read another manager event', async () => {
  let query: unknown;
  const restore = replaceMethod(
    prisma.event,
    'findFirst',
    async (...args) => {
      query = args[0];
      return null;
    },
  );
  try {
    await assert.rejects(
      eventsService.get(manager, eventId),
      (error: unknown) =>
        error instanceof AppError && error.code === 'EVENT_NOT_FOUND',
    );
    assert.deepEqual((query as { where: unknown }).where, {
      id: eventId,
      deletedAt: null,
      createdById: manager.id,
    });
  } finally {
    restore();
  }
});

test('category quota cannot fall below sold plus reserved tickets', async () => {
  const fakeTransaction = {
    event: {
      findFirst: async () => ({ id: eventId }),
    },
    ticketCategory: {
      findFirst: async () => ({
        id: categoryId,
        eventId,
        quota: 10,
        sold: 4,
        reserved: 2,
      }),
      update: async () => {
        throw new Error('Category should not be updated');
      },
    },
  };
  const restoreEvent = replaceMethod(
    prisma.event,
    'findFirst',
    async () => ({ id: eventId }),
  );
  const restoreTransaction = replaceMethod(
    prisma,
    '$transaction',
    async (...args) =>
      (args[0] as (tx: typeof fakeTransaction) => Promise<unknown>)(
        fakeTransaction,
      ),
  );
  try {
    await assert.rejects(
      eventsService.updateCategory(manager, eventId, categoryId, { quota: 5 }),
      (error: unknown) =>
        error instanceof AppError && error.code === 'QUOTA_BELOW_ALLOCATED',
    );
  } finally {
    restoreTransaction();
    restoreEvent();
  }
});
