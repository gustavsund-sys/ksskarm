import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockholmISO } from '../public/stockholm.mjs';
test('manual concert times use Stockholm rather than the device timezone', () => {
  assert.equal(stockholmISO('2026-09-17', '19:00'), '2026-09-17T19:00:00+02:00');
  assert.equal(stockholmISO('2027-01-21', '19:00'), '2027-01-21T19:00:00+01:00');
});
test('invalid dates and daylight saving gaps or repeated times are rejected', () => {
  for (const [date, time] of [['2026-02-30','12:00'], ['2026-03-29','02:30'], ['2026-10-25','02:30'], ['2026-10-01','25:00']]) {
    assert.throws(() => stockholmISO(date,time));
  }
});
