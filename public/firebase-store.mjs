import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.mjs';
import { stockholmISO } from './stockholm.mjs';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let source = { events: [], excluded: [], syncedAt: null };
let edits = {};
let manual = [];
let canEdit = false;
let emit = () => {};
const errors = new Map();
const snapshot = () => ({ ...source, events: [...source.events, ...manual].sort((a,b) => new Date(a.start) - new Date(b.start)), edits, error: [...errors.values()].join(' ') || null });
const publish = () => emit(snapshot());
const friendly = error => ({
  'permission-denied': 'Databasen saknar läsbehörighet. Kontrollera Firestore-reglerna.',
  'auth/operation-not-allowed': 'Lösenordsinloggning behöver aktiveras i Firebase Authentication.',
  'auth/invalid-credential': 'Fel lösenord.',
  'auth/wrong-password': 'Fel lösenord.',
  'auth/user-not-found': 'Inloggningen är inte konfigurerad ännu.',
  'auth/too-many-requests': 'För många inloggningsförsök. Vänta en stund och försök igen.',
  'resource-exhausted': 'Databasens tillgängliga kvot har nåtts. Senast hämtade uppgifter visas.',
}[error.code] || 'Anslutningen till Firebase misslyckades. Försök igen.');

export function subscribe(onData, onAccess) {
  emit = onData;
  const listen = (name, accept) => onSnapshot(collection(db, name), docs => {
    accept(docs.docs); errors.delete(name); publish();
  }, error => { errors.set(name, friendly(error)); publish(); });
  const stops = [
    listen('concertEdits', docs => { edits = Object.fromEntries(docs.map(d => [d.id, d.data()])); }),
    listen('manualConcerts', docs => { manual = docs.map(d => { const v = d.data(); return { ...v, id: d.id, start: v.start.toDate().toISOString(), end: v.end.toDate().toISOString(), date: new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Stockholm', year:'numeric',month:'2-digit',day:'2-digit'}).format(v.start.toDate()), manual: true, kind:'extra' }; }); }),
    onAuthStateChanged(auth, async user => {
      canEdit = false;
      onAccess({ user, canEdit, checking: !!user });
      if (!user) return;
      try {
        const access = await getDoc(doc(db, 'screenAdmins', user.uid));
        if (auth.currentUser?.uid !== user.uid) return;
        canEdit = access.exists() && access.data().enabled === true;
        onAccess({ user, canEdit, checking: false });
      } catch (error) { onAccess({ user, canEdit: false, checking: false, error: friendly(error) }); }
    }),
  ];
  return () => stops.forEach(stop => stop());
}

export async function refreshSource() {
  const response = await fetch(new URL('./schedule.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Schemat kunde inte hämtas.');
  const fresh = await response.json();
  if (!Array.isArray(fresh.events) || !Array.isArray(fresh.excluded) || !fresh.syncedAt) throw new Error('Felaktigt schemaformat.');
  source = fresh;
  publish();
  return snapshot();
}

export async function login(password) {
  try { await signInWithEmailAndPassword(auth, 'skarmadmin@ksskarm.firebaseapp.com', password); }
  catch (error) { throw new Error(friendly(error)); }
}
export const logout = () => signOut(auth);

export async function saveConcert(payload, isManual) {
  if (!canEdit || !auth.currentUser) throw new Error('Du behöver vara inloggad som administratör.');
  const collectionName = isManual ? 'manualConcerts' : 'concertEdits';
  const id = payload.id || `manual:${crypto.randomUUID()}`;
  const ref = doc(db, collectionName, id);
  if (payload.reset || payload.delete) { await deleteDoc(ref); return snapshot(); }
  const title = payload.title.trim();
  if (!title || title.length > 240 || payload.description.length > 600) throw new Error('Kontrollera rubrik och beskrivning.');
  const eventType = payload.eventType?.trim() || '';
  if (!eventType || eventType.length > 40) throw new Error('Evenemangstypen behöver vara 1–40 tecken.');
  const record = { title, eventType, description: payload.description.trim(), hidden: payload.hidden, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid };
  if (isManual) {
    const start = new Date(stockholmISO(payload.date, payload.startTime));
    const end = new Date(stockholmISO(payload.date, payload.endTime));
    if (end <= start) throw new Error('Sluttiden måste vara efter starttiden samma dag.');
    Object.assign(record, { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) });
  } else {
    const original = source.events.find(e => e.id === id);
    if (!original) throw new Error('Bokningen finns inte längre i schemat.');
    record.sourceTitle = original.title;
  }
  await setDoc(ref, record);
  return snapshot();
}
