/**
 * Plays the browser at the stand-in provider: follows its redirects with a cookie jar, picks the
 * named user from its page, and returns the URL the provider sends the browser back to.
 *
 * `reachAt` is where to actually knock, when the provider's own name is not one this machine
 * resolves - the compose stack's provider calls itself `idp.localhost`, which is a name for the
 * browser and the containers rather than for a test process. Every address the provider gives is
 * still its own, under one name or the other, so only the origin is swapped; the first address
 * that is neither is where the browser is being sent back to, and is returned untouched.
 */
export async function completeAtStandIn(
  url: string,
  user: string,
  issuer: string,
  reachAt: string = issuer,
): Promise<URL> {
  const its = new URL(issuer).origin;
  const knockAt = new URL(reachAt).origin;
  const jar = new Map<string, string>();
  let next = new URL(url);
  for (let hop = 0; hop < 10; hop++) {
    // Either name is the provider: it answers under its own, and sends the browser on under
    // whichever one the request arrived at.
    if (next.origin !== its && next.origin !== knockAt) return next;
    const response = await fetch(new URL(next.pathname + next.search, knockAt), {
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
