import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeHtml } from '../src/lib/mailer.logic';
import { ticketTokenQuerySchema } from '../src/modules/tickets/tickets.schemas';

test('email HTML values are escaped before rendering', () => {
  assert.equal(
    escapeHtml(`<script>alert("x") & 'y'</script>`),
    '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
  );
});

test('ticket lookup requires a sufficiently long access token', () => {
  assert.equal(
    ticketTokenQuerySchema.parse({ token: 'a'.repeat(32) }).token.length,
    32,
  );
  assert.throws(() => ticketTokenQuerySchema.parse({ token: 'too-short' }));
});
