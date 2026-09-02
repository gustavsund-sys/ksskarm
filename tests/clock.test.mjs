import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../public/clock.mjs';

test('server time survives wrong system time and later network failures', async () => {
  let tick = 100, wall = 0, offline = false;
  const server = Date.parse('Wed, 02 Sep 2026 10:00:00 GMT');
  const clock = createClock({ ticks: () => tick, fallback: () => wall, fetcher: async () => {
    if (offline) throw new Error('offline');
    tick += 100;
    return new Response(null, { headers: { Date: new Date(server).toUTCString(), Age: '0' } });
  } });
  assert.equal(clock.synced, false);
  assert.equal(await clock.sync(), true);
  assert.equal(clock.now(), server + 50);
  wall = 9999999999999;
  tick += 2000;
  assert.equal(clock.now(), server + 2050);
  offline = true;
  assert.equal(await clock.sync(), false);
  assert.equal(clock.synced, true);
  assert.equal(clock.now(), server + 2050);
});

test('cached or invalid responses do not establish server time', async () => {
  for (const headers of [{ Date: 'invalid' }, { Date: 'Wed, 02 Sep 2026 10:00:00 GMT', Age: '600' }]) {
    const clock = createClock({ fallback: () => 123, fetcher: async () => new Response(null, { headers }) });
    assert.equal(await clock.sync(), false);
    assert.equal(clock.synced, false);
    assert.equal(clock.now(), 123);
  }
});
