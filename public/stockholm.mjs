const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function stockholmISO(date, clock) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clock)) throw new Error('Ange ett giltigt datum och klockslag.');
  const local = `${date}T${clock}:00`;
  // Try the two Swedish offsets; reject nonexistent spring times, independent of device TZ.
  const candidates = ['+02:00', '+01:00'].filter(offset => {
    const candidate = new Date(local + offset);
    return Number.isFinite(+candidate) && formatter.format(candidate).replace(' ', 'T') === `${date}T${clock}`;
  });
  if (!candidates.length) throw new Error('Datumet eller tiden är ogiltig, eller saknas vid övergången till sommartid.');
  if (candidates.length > 1) throw new Error('Tiden inträffar två gånger vid övergången till vintertid. Välj en annan tid.');
  return local + candidates[0];
}
