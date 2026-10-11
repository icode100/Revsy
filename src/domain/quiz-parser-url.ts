/** Allow an HTTPS parser service or the Firebase Hosting API rewrite. */
export function resolveQuizParserUrl(configured: string | undefined, development: boolean, origin?: string): string | null {
  const value = configured?.trim();
  if (!value) return null;
  try {
    // Only the documented Hosting rewrite may use a relative URL. In particular,
    // protocol-relative hosts must not inherit this application's credentials.
    const url = value.startsWith('/')
      ? /^\/api\/?$/.test(value) && origin ? new URL('/api', origin) : null
      : new URL(value);
    if (!url) return null;
    const local = development && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}
