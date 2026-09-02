export function startVersionCheck() {
  const current = document.querySelector('meta[name="app-version"]')?.content;
  if (!current || !/^[a-f0-9]{16}$/.test(current)) return;
  let checking = false;
  let navigating = false;
  async function check() {
    if (checking || navigating) return;
    checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const url = new URL('./version.json', import.meta.url);
      url.searchParams.set('check', crypto.randomUUID());
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const { version } = await response.json();
      if (typeof version !== 'string' || !/^[a-f0-9]{16}$/.test(version) || version === current) return;
      const target = new URL(location.href);
      target.searchParams.set('v', version);
      // Confirm the new HTML is available before navigating; keep kiosk parameters.
      const page = await fetch(target, { cache: 'no-store', signal: controller.signal });
      if (!page.ok) return;
      const html = new DOMParser().parseFromString(await page.text(), 'text/html');
      if (html.querySelector('meta[name="app-version"]')?.content !== version) return;
      navigating = true;
      location.replace(target.href);
    } catch { /* Continue showing the current version while offline. */ }
    finally { clearTimeout(timeout); checking = false; }
  }
  setInterval(check, 60000);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}
