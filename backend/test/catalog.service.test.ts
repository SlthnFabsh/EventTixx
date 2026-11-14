import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatPublicEvent,
  getTicketSaleState,
} from '../src/modules/events/catalog.service';

const category = {
  id: 'category-id',
  name: 'Regular',
  description: null,
  price: 250_000,
  maxPerOrder: 4,
  saleStartAt: new Date('2026-11-01T00:00:00.000Z'),
  saleEndAt: new Date('2026-12-01T00:00:00.000Z'),
  quota: 10,
  sold: 4,
  reserved: 2,
};

test('ticket sale state respects the sale window and remaining quota', () => {
  assert.equal(
    getTicketSaleState(category, new Date('2026-10-31T23:59:59.000Z')),
    'UPCOMING',
  );
  assert.equal(
    getTicketSaleState(category, new Date('2026-11-15T00:00:00.000Z')),
    'ON_SALE',
  );
  assert.equal(
    getTicketSaleState(
      { ...category, reserved: 6 },
      new Date('2026-11-15T00:00:00.000Z'),
    ),
    'SOLD_OUT',
  );
  assert.equal(
    getTicketSaleState(category, new Date('2026-12-01T00:00:00.000Z')),
    'CLOSED',
  );
});

test('public event formatter excludes internal event and inventory fields', () => {
  const formatted = formatPublicEvent(
    {
      id: 'event-id',
      title: 'Event',
      slug: 'event',
      description: null,
      posterUrl: null,
      venueName: 'Venue',
      venueAddress: null,
      city: 'Jakarta',
      startAt: new Date('2027-01-01T00:00:00.000Z'),
      endAt: null,
      categories: [category],
    },
    new Date('2026-11-15T00:00:00.000Z'),
  );

  assert.deepEqual(Object.keys(formatted).sort(), [
    'categories',
    'city',
    'description',
    'endAt',
    'id',
    'posterUrl',
    'slug',
    'startAt',
    'title',
    'venueAddress',
    'venueName',
  ]);
  const firstCategory = formatted.categories[0];
  assert.ok(firstCategory);
  assert.equal(firstCategory.available, 4);
  assert.equal(firstCategory.saleState, 'ON_SALE');
  assert.equal('sold' in firstCategory, false);
  assert.equal('reserved' in firstCategory, false);
});
