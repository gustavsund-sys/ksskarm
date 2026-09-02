export function selectProgram(events, now) {
  const visible = events.filter(e => !e.hidden).sort((a, b) => new Date(a.start) - new Date(b.start));
  const live = visible.filter(e => +new Date(e.start) <= now && +new Date(e.end) > now);
  const next = visible.find(e => +new Date(e.start) > now);
  const current = live.length ? live[Math.floor(now / 15000) % live.length] : next;
  const limit = (current?.title?.length > 100 || current?.description?.length > 250) ? 2 : 3;
  const upcoming = visible.filter(e => +new Date(e.start) > now && e.id !== current?.id).slice(0, limit);
  return { current, next, live, upcoming };
}
