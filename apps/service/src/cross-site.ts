import { AppError } from './errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A write carrying the session cookie that a browser sent from anywhere but the app itself: refused
 * before any route runs. The cookie's `SameSite=Lax` already keeps it off most cross-site requests;
 * this holds for a sibling name too, which is the same site but another origin, and for any browser
 * that sends the cookie anyway.
 *
 * The browser's word decides: `Sec-Fetch-Site` when it sends one, else `Origin`. A request with
 * neither came from no browser (a script, an integration), which a cross-site request cannot be.
 * A caller with no session cookie (a token, the bridge's signature) has nothing to ride on, so it is
 * never asked.
 */
export function crossSiteRefusal(request: {
  readonly method: string;
  readonly session: boolean;
  readonly ownOrigin: string;
  readonly origin?: string | undefined;
  readonly fetchSite?: string | undefined;
}): AppError | undefined {
  if (!request.session || SAFE.has(request.method.toUpperCase())) return undefined;
  const fromElsewhere =
    request.fetchSite !== undefined
      ? request.fetchSite !== 'same-origin'
      : request.origin !== undefined &&
        request.origin.toLowerCase() !== request.ownOrigin.toLowerCase();
  return fromElsewhere
    ? new AppError(403, 'cross_site_refused', 'This change was sent from another site.')
    : undefined;
}
