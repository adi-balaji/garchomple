// Garchomple — fetch that rides out a server that isn't up yet (e.g. the browser opened a cached page
// a moment before the local server started). Retries network errors and 5xx with a short backoff.
export async function fetchRetry(url, opts = {}, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status < 500) return r;
      last = new Error(`${url}: HTTP ${r.status}`);
    } catch (e) { last = e; }
    await new Promise(res => setTimeout(res, Math.min(250 * 2 ** i, 2000)));
  }
  throw last;
}
