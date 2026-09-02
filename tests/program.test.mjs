import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectProgram } from '../public/program.mjs';
const events = [
  { id: 'a', start: '2026-09-17T12:30:00+02:00', end: '2026-09-17T14:00:00+02:00' },
  { id: 'b', start: '2026-09-17T19:00:00+02:00', end: '2026-09-17T21:00:00+02:00' },
];
const at = clock => selectProgram(events, +new Date(`2026-09-17T${clock}+02:00`));
test('before start shows next concert, not booking preparation time', () => {
  assert.equal(at('12:00:00').current.id, 'a');
  assert.equal(at('12:00:00').live.length, 0);
});
test('at start poster remains and countdown refers to next concert', () => {
  assert.equal(at('12:30:00').current.id, 'a');
  assert.equal(at('12:30:00').live.length, 1);
  assert.equal(at('12:30:00').next.id, 'b');
});
test('poster stays until booking end, switches exactly at end', () => {
  assert.equal(at('13:59:59').current.id, 'a');
  assert.equal(at('14:00:00').current.id, 'b');
  assert.equal(at('14:00:00').live.length, 0);
  assert.equal(at('20:59:59').current.id, 'b');
  assert.equal(at('21:00:00').current, undefined);
});
test('hidden and manually added concerts obey same selection rules', () => {
  const manual = { id: 'm', manual: true, start: '2026-09-17T15:45:00+02:00', end: '2026-09-17T17:00:00+02:00' };
  const result = selectProgram([{ ...events[0], hidden: true }, events[1], manual], +new Date('2026-09-17T16:00:00+02:00'));
  assert.equal(result.current.id, 'm');
  assert.equal(result.next.id, 'b');
});
