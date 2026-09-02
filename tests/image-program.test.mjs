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

test('different days select their own images and gaps show normal programme', () => {
  const first = { id: 'a', start: '2026-09-02T08:00:00Z', end: '2026-09-02T16:00:00Z' };
  const second = { id: 'b', start: '2026-09-03T08:00:00Z', end: '2026-09-03T16:00:00Z' };
  assert.equal(activeImage([first, second], Date.parse(first.start)), first);
  assert.equal(activeImage([first, second], Date.parse(first.end)), null);
  assert.equal(activeImage([first, second], Date.parse(second.start)), second);
});

test('overlapping images prioritize latest start and restore earlier image afterwards', () => {
  const allDay = { id: 'a', start: '2026-09-02T08:00:00Z', end: '2026-09-02T16:00:00Z' };
  const lunch = { id: 'b', start: '2026-09-02T10:00:00Z', end: '2026-09-02T11:00:00Z' };
  assert.equal(activeImage([allDay, lunch], Date.parse(lunch.start)), lunch);
  assert.equal(activeImage([lunch, allDay], Date.parse(lunch.end)), allDay);
});
