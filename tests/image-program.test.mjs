import test from 'node:test';
import assert from 'node:assert/strict';
import { activeImage } from '../public/image-program.mjs';
test('program image starts inclusively and ends exclusively', () => {
  const record = { start: '2026-09-02T10:00:00.000Z', end: '2026-09-02T12:00:00.000Z' };
  assert.equal(activeImage(record, Date.parse(record.start) - 1), null);
  assert.equal(activeImage(record, Date.parse(record.start)), record);
  assert.equal(activeImage(record, Date.parse(record.end) - 1), record);
  assert.equal(activeImage(record, Date.parse(record.end)), null);
  assert.equal(activeImage(null, Date.now()), null);
});
