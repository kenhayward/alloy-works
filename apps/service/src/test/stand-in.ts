/**
 * Plays the browser at the stand-in provider: follows its redirects with a cookie jar, picks the
 * named user from its page, and returns the URL the provider sends the browser back to.
 */
export async function completeAtStandIn(url: string, user: string, issuer: string): Promise<URL> {
  const jar = new Map<string, string>();
  let next = new URL(url);
  for (let hop = 0; hop < 10; hop++) {
    if (next.origin !== new URL(issuer).origin) return next;
    const response = await fetch(next, {
      redirect: 'manual',
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? '';
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const location = response.headers.get('location');
    if (location) {
      next = new URL(location, next);
      continue;
    }
    const page = await response.text();
    const choice = new RegExp(`href="(/interaction/[^"]+user=${user})"`).exec(page);
    if (!choice?.[1]) throw new Error(`The stand-in offered no user called ${user}`);
    next = new URL(choice[1], next);
  }
  throw new Error('The stand-in never sent the browser back');
}
