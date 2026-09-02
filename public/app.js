import { selectProgram } from './program.mjs';
import { activeImage, overlappingImages, setupImageEditor } from './image-program.mjs';
import { createClock } from './clock.mjs';
const clock = createClock();
const initialClockSync = clock.sync();
const $ = id => document.getElementById(id);
const admin = location.pathname === '/admin' || new URLSearchParams(location.search).has('admin');
const local = ['localhost', '127.0.0.1'].includes(location.hostname) && !new URLSearchParams(location.search).has('firebase');
let cloud;
let canEdit = local;
const kiosk = new URLSearchParams(location.search).has('kiosk');
$('screen').hidden = admin;
$('admin').hidden = !admin;
document.querySelector('.preview-controls').hidden = admin || kiosk;
$('local-notice').hidden = !local;
$('login-panel').hidden = local || !admin;
let data = { events: [], edits: {}, excluded: [] };
let selectedId = null;
let editingManual = false;
let loading = true;
let networkError = false;
let failedImage = null;
$('scheduled-image-content').addEventListener('error', () => {
  failedImage = { url: $('scheduled-image-content').getAttribute('src'), retryAt: clock.now() + 60000 };
  renderScreen();
});
const fmt = (date, options) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(new Date(date));
const time = date => fmt(date, { hour: '2-digit', minute: '2-digit' });
const fullDate = date => fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const kind = e => e.eventType || (e.kind === 'extra' ? 'Extra konsert' : e.kind === 'lunch' ? 'Lunchkonsert' : 'Kvällskonsert');
const effective = e => ({ ...e, ...data.edits[e.id] });
function node(tag, text, cls) { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; }
function countdown(start) {
  const seconds = Math.max(0, Math.ceil((new Date(start) - clock.now()) / 1000));
  const days = Math.floor(seconds / 86400);
  const units = days ? [[days, 'dagar'], [Math.floor(seconds % 86400 / 3600), 'tim'], [Math.floor(seconds % 3600 / 60), 'min']] : [[Math.floor(seconds / 3600), 'tim'], [Math.floor(seconds % 3600 / 60), 'min'], [seconds % 60, 'sek']];
  $('countdown').replaceChildren(...units.map(([value, label]) => { const el = node('div', ''); el.append(node('b', String(value).padStart(2, '0')), node('em', label)); return el; }));
}
function renderScreen() {
  const now = clock.now();
  let programImage = activeImage(data.imagePrograms, now);
  if (failedImage && programImage?.image === failedImage.url) {
    if (now < failedImage.retryAt) programImage = null;
    else { failedImage = null; $('scheduled-image-content').removeAttribute('src'); }
  }
  $('screen').classList.toggle('image-mode', !!programImage);
  $('scheduled-image').hidden = !programImage;
  if (programImage) {
    if ($('scheduled-image-content').getAttribute('src') !== programImage.image) $('scheduled-image-content').src = programImage.image;
    $('scheduled-image-content').alt = programImage.title;
  }
  const { current, next, live, upcoming } = selectProgram(data.events.map(effective), now);
  $('today').textContent = fmt(now, { day: 'numeric', month: 'long', year: 'numeric' });
  $('clock').textContent = time(now);
  const stale = data.syncedAt && now - +new Date(data.syncedAt) > 20 * 60 * 1000;
  $('health').textContent = networkError || data.error || stale ? (data.syncedAt ? `Senast hämtat ${fmt(data.syncedAt, {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}` : 'Schemat är inte tillgängligt') : '';
  $('health').title = data.error || '';
  $('start-block').hidden = !current;
  $('countdown-block').hidden = !next;
  const eventName = (current?.eventType || 'Konsert').toLocaleUpperCase('sv');
  $('status').textContent = live.length ? `${eventName} PÅGÅR` : current ? 'NÄSTA KONSERT:' : 'PROGRAM';
  $('kind').textContent = current ? kind(current).toUpperCase() : '';
  $('kind').hidden = !current;
  $('concert-date').replaceChildren(...(current ? ['day', 'month', 'year'].map(part => node('span', fmt(current.start, { [part]: part === 'month' ? 'short' : 'numeric' }).replace('.', '').toLocaleUpperCase('sv'))) : []));
  $('title').textContent = current?.title || 'Musik att se fram emot.';
  $('title').className = current?.title.length > 100 ? 'long' : current?.title.length > 55 ? 'medium' : '';
  $('description').textContent = current?.description || (current ? '' : loading ? 'Hämtar konsertprogrammet…' : !data.syncedAt ? 'Konsertprogrammet är tillfälligt otillgängligt.' : 'Inga kommande konserter är inbokade i de valda tidsintervallen.');
  $('description').classList.toggle('long', ($('description').textContent.length > 250));
  $('start-time').textContent = current ? time(current.start) : '';
  if (next) {
    $('countdown-context').hidden = !live.length;
    $('countdown-block').classList.toggle('countdown-only', !live.length);
    $('countdown-label').textContent = live.length ? `NÄSTA ${(next.eventType || 'Konsert').toLocaleUpperCase('sv')} OM` : '';
    $('countdown-title').textContent = live.length ? next.title : '';
    countdown(next.start);
  }
  $('upcoming').hidden = !upcoming.length;
  $('upcoming-list').replaceChildren(...upcoming.map(e => {
    const row = node('div', '', 'upcoming-row');
    const date = node('div', '', 'mini-date');
    date.append(node('strong', fmt(e.start, { day: 'numeric' })), node('span', fmt(e.start, { month: 'short' })));
    const title = node('div', e.title, 'mini-title'); title.append(node('small', kind(e)));
    row.append(date, title, node('span', time(e.start), 'mini-time')); return row;
  }));
}
function renderAdmin() {
  $('image-admin').hidden = !canEdit;
  const images = [...(data.imagePrograms || [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  $('image-summary').textContent = images.length ? `${images.length} schemalagda bilder` : 'Ingen bild schemalagd.';
  $('image-list').replaceChildren(...images.map(record => {
    const card = node('article', '', 'admin-card');
    const body = node('div', '');
    body.append(node('h3', record.title), node('p', `${fullDate(record.start)} ${time(record.start)} – ${fullDate(record.end)} ${time(record.end)}`));
    const state = Date.parse(record.end) <= clock.now() ? 'Avslutad' : Date.parse(record.start) <= clock.now() ? 'Aktuell period' : 'Kommande';
    body.append(node('span', state, 'badge'));
    if (overlappingImages(record, images).length) body.append(node('p', 'Överlappande tider: bilden med senaste starttid prioriteras.'));
    const button = node('button', 'Redigera bild'); button.disabled = !canEdit;
    button.onclick = () => imageEditor.open(record);
    card.append(body, button); return card;
  }));
  const query = $('search').value.toLocaleLowerCase('sv');
  $('event-count').textContent = data.events.length;
  $('sync-info').textContent = data.syncedAt ? `Senast hämtat ${fullDate(data.syncedAt)} ${time(data.syncedAt)}` : 'Ingen lyckad hämtning ännu';
  $('admin-message').textContent = networkError ? 'Anslutningen bröts. Senast hämtade uppgifter visas.' : data.error || '';
  const events = data.events.filter(e => `${e.title} ${effective(e).title}`.toLocaleLowerCase('sv').includes(query));
  $('admin-list').replaceChildren(...events.map(original => {
    const e = effective(original); const card = node('article', '', 'admin-card'); const body = node('div', '');
    const date = node('p', `${fullDate(e.start)} · ${time(e.start)}–${time(e.end)} · ${kind(e)}`);
    if (data.edits[e.id] || e.manual) date.append(node('span', e.hidden ? 'Dold' : e.manual ? 'Manuellt tillagd' : 'Redigerad', 'badge'));
    body.append(date, node('h2', e.title), node('p', e.manual ? 'Egen konsert · påverkas inte av schemauppdateringar' : `Bokningsintervall ${e.bookingInterval}`));
    if (data.edits[e.id] && data.edits[e.id].sourceTitle !== original.title) body.append(node('p', 'Momenttexten har ändrats i källschemat. Kontrollera din redigering.'));
    const button = node('button', 'Redigera'); button.disabled = !canEdit; button.addEventListener('click', () => openEditor(original));
    card.append(body, button); return card;
  }));
  if (!events.length) $('admin-list').append(node('p', loading ? 'Hämtar bokningar…' : 'Inga konserter matchar.', 'admin-empty'));
  $('excluded-summary').textContent = `${data.excluded.length} bokningar utanför de valda intervallen`;
  $('excluded-list').replaceChildren(...data.excluded.map(e => node('div', `${e.date} · ${e.interval} · ${e.title}`, 'excluded-row')));
  $('add-concert').disabled = !canEdit;
}
async function refresh() {
  try {
    if (!local) {
      if (!cloud) throw new Error('Firebase kunde inte laddas.');
      data = await cloud.refreshSource(); networkError = false;
    } else {
    const response = await fetch('/api/schedule', { cache: 'no-store' });
    if (!response.ok) throw new Error('Kunde inte läsa schemat.');
    const fresh = await response.json();
    if (!Array.isArray(fresh.events) || !fresh.edits || !Array.isArray(fresh.excluded)) throw new Error('Felaktigt svar.');
    data = fresh; networkError = false;
    }
  } catch { networkError = true; }
  loading = false;
  if (admin) renderAdmin(); else renderScreen();
}
function openEditor(original = null) {
  if (!canEdit) return;
  selectedId = original?.id || null;
  editingManual = !original || !!original.manual;
  const e = original ? effective(original) : { title: '', start: new Date(clock.now()), end: new Date(clock.now()) };
  $('editor-label').textContent = original ? 'REDIGERA KONSERT' : 'LÄGG TILL KONSERT';
  $('edit-date').textContent = original ? fullDate(e.start) : 'En extra konsert';
  $('source-title').textContent = editingManual ? 'Välj tider fritt. Konserten sparas som en egen post.' : `Original i schemat: ${original.title}`;
  $('manual-date-label').hidden = !editingManual;
  $('manual-date').required = editingManual;
  $('manual-date').value = original?.date || fmt(new Date(clock.now()), { year:'numeric', month:'2-digit', day:'2-digit' });
  $('edit-start').disabled = !editingManual;
  $('edit-end').disabled = !editingManual;
  $('edit-type').value = original ? kind(e) : 'Konsert';
  $('edit-title').value = e.title;
  $('edit-description').value = e.description || '';
  $('edit-start').value = original ? time(e.start) : '19:00';
  $('edit-end').value = original ? time(e.end) : '21:00';
  $('edit-hidden').checked = !!e.hidden;
  $('edit-message').textContent = '';
  $('reset-edit').disabled = !data.edits[e.id];
  $('reset-edit').hidden = editingManual;
  $('delete-manual').hidden = !editingManual || !original;
  $('editor').showModal();
}
async function save(reset = false, remove = false) {
  const buttons = [...$('edit-form').querySelectorAll('button')];
  buttons.forEach(b => b.disabled = true);
  try {
    const payload = reset ? { id: selectedId, reset: true } : { id: selectedId, title: $('edit-title').value, eventType: $('edit-type').value.trim(), description: $('edit-description').value, hidden: $('edit-hidden').checked };
    if (editingManual) Object.assign(payload, { date: $('manual-date').value, startTime: $('edit-start').value, endTime: $('edit-end').value, delete: remove });
    if (!local) {
      data = await cloud.saveConcert(payload, editingManual); renderAdmin(); $('editor').close();
      return;
    }
    const response = await fetch(editingManual ? '/api/manual' : '/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Ändringen kunde inte sparas.');
    data = body; renderAdmin(); $('editor').close();
  } catch (error) { $('edit-message').textContent = error.message; }
  finally { buttons.forEach(b => b.disabled = false); }
}
const imageEditor = setupImageEditor({ now: () => clock.now(), save: async (record, id) => {
  if (!canEdit) throw new Error('Logga in för att spara.');
  if (!local) await cloud.saveImageProgram(record, id);
  else {
    const response = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record, id }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Bilden kunde inte sparas.');
    data = body;
  }
  renderAdmin();
} });
$('edit-form').addEventListener('submit', e => { e.preventDefault(); save(); });
$('reset-edit').addEventListener('click', () => save(true));
$('add-concert').addEventListener('click', () => openEditor());
$('delete-manual').addEventListener('click', () => { if (confirm('Ta bort den här extra konserten?')) save(false, true); });
$('close-editor').addEventListener('click', () => $('editor').close());
$('search').addEventListener('input', renderAdmin);
$('fullscreen').addEventListener('click', async () => {
  try { await document.documentElement.requestFullscreen(); } catch { $('fullscreen').textContent = 'Använd webbläsarens helskärm'; }
});
if (!local) {
  try {
    cloud = await import('./firebase-store.mjs');
    cloud.subscribe(fresh => {
      data = fresh;
      if (admin) renderAdmin(); else renderScreen();
    }, access => {
      canEdit = access.canEdit;
      $('login-panel').hidden = !admin || canEdit;
      $('logout').hidden = !admin || !access.user;
      $('login-message').textContent = access.error || (access.checking ? 'Kontrollerar behörighet…' : access.user && !canEdit ? 'Kontot saknar redigeringsbehörighet.' : '');
      if (admin) renderAdmin();
    });
  } catch { $('login-message').textContent = 'Inloggningen kunde inte laddas. Kontrollera anslutningen och ladda om sidan.'; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('login-button'); button.disabled = true;
  $('login-message').textContent = 'Loggar in…';
  try {
    if (!cloud) throw new Error('Anslutningen saknas. Ladda om sidan.');
    await cloud.login($('password').value); $('password').value = '';
  } catch (error) { $('login-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { await cloud.logout(); $('editor').close(); });
await initialClockSync;
await refresh();
async function syncClock() { await clock.sync(); if (!admin) renderScreen(); }
setInterval(syncClock, 60000);
window.addEventListener('online', syncClock);
window.addEventListener('pageshow', syncClock);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncClock(); });
setInterval(() => { if (!admin) renderScreen(); }, 1000);
// Serialize polling so slow responses never overwrite a newer response.
async function poll() { await refresh(); setTimeout(poll, 15000); }
setTimeout(poll, 15000);
