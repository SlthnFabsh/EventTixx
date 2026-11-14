import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  scanManualSchema,
  scanTicketSchema,
} from '../src/modules/gate/gate.schemas';

const eventId = '00000000-0000-4000-8000-000000000001';

test('QR scan trims payload before lookup', () => {
  const parsed = scanTicketSchema.parse({
    eventId,
    qrToken: '  secret-qr-token  ',
  });
  assert.equal(parsed.qrToken, 'secret-qr-token');
});

test('manual scan accepts generated ticket-code shape only', () => {
  assert.equal(
    scanManualSchema.parse({
      eventId,
      ticketCode: ' ETX-ABCDEFG2 ',
    }).ticketCode,
    'ETX-ABCDEFG2',
  );
  assert.throws(() =>
    scanManualSchema.parse({ eventId, ticketCode: 'ETX-bad' }),
  );
});
