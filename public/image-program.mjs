import { stockholmISO } from './stockholm.mjs';

export function activeImage(record, now) {
  return record && Date.parse(record.start) <= now && now < Date.parse(record.end) ? record : null;
}

export async function prepareImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Välj en JPG-, PNG- eller WebP-bild.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Bilden får vara högst 20 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', .9);
      if (result.length <= 850000) return result;
      scale *= .8;
    }
    throw new Error('Bilden är för stor. Prova en mindre bild.');
  } finally { bitmap.close(); }
}

export function setupImageEditor({ save, current, now }) {
  const $ = id => document.getElementById(id);
  let image = null;
  let busy = false;
  const dateTime = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)).replace(' ', 'T');
  $('open-image').onclick = () => {
    const record = current();
    image = record?.image?.startsWith('data:') ? record.image : null;
    $('image-url').value = record?.image?.startsWith('https://') ? record.image : '';
    $('image-name').value = record?.title || '';
    $('image-start').value = dateTime(record?.start || now());
    $('image-end').value = dateTime(record?.end || now() + 3600000);
    $('image-file').value = '';
    $('image-preview').src = record?.image || '';
    $('image-preview').hidden = !record?.image;
    $('image-message').textContent = '';
    $('remove-image').hidden = !record;
    $('image-editor').showModal();
  };
  const lock = value => {
    busy = value;
    for (const el of $('image-form').querySelectorAll('button, input')) el.disabled = value;
  };
  $('close-image').onclick = () => $('image-editor').close();
  $('image-editor').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('image-file').onchange = async () => {
    if (!$('image-file').files[0]) return;
    lock(true); $('image-message').textContent = 'Förbereder bilden…';
    try {
      $('image-url').value = '';
      image = await prepareImage($('image-file').files[0]);
      $('image-preview').src = image; $('image-preview').hidden = false;
      $('image-message').textContent = '';
    } catch (error) { $('image-message').textContent = error.message; }
    finally { lock(false); }
  };
  $('image-url').onchange = () => {
    const url = $('image-url').value.trim();
    if (url.startsWith('https://')) { $('image-preview').src = url; $('image-preview').hidden = false; }
    else { $('image-preview').src = image || ''; $('image-preview').hidden = !image; }
  };
  async function submit(remove) {
    lock(true); $('image-message').textContent = 'Sparar…';
    try {
      let record = null;
      if (!remove) {
        const external = $('image-url').value.trim();
        let chosen = image;
        if (external) {
          const url = new URL(external);
          if (url.protocol !== 'https:' || url.username || url.password || external.length > 4000) throw new Error('Ange en offentlig HTTPS-länk utan inloggningsuppgifter.');
          chosen = url.href;
        }
        if (!chosen) throw new Error('Välj en bild eller ange en extern bildlänk.');
        // Check that the browser can display the external resource before saving.
        if (external) await new Promise((resolve, reject) => {
          const probe = new Image();
          const timer = setTimeout(() => reject(new Error('Bildlänken svarar inte. Försök igen.')), 10000);
          probe.onload = () => { clearTimeout(timer); resolve(); };
          probe.onerror = () => { clearTimeout(timer); reject(new Error('Länken kunde inte visas som bild. Ange en direktlänk till en offentlig bild.')); };
          probe.src = chosen;
        });
        const convert = value => { const [date, time] = value.split('T'); return new Date(stockholmISO(date, time)).toISOString(); };
        const start = convert($('image-start').value), end = convert($('image-end').value);
        if (Date.parse(end) <= Date.parse(start)) throw new Error('Sluttiden måste vara efter starttiden.');
        record = { title: $('image-name').value.trim(), image: chosen, start, end };
        if (!record.title) throw new Error('Ange ett namn för bilden.');
      }
      await save(record);
      $('image-editor').close();
    } catch (error) { $('image-message').textContent = error.message; }
    finally { lock(false); }
  }
  $('image-form').onsubmit = e => { e.preventDefault(); submit(false); };
  $('remove-image').onclick = () => { if (confirm('Ta bort den schemalagda bilden?')) submit(true); };
}
