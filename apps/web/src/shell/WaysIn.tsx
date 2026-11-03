import { useWords } from '../words/words.js';

/**
 * Where a way in starts, bringing the person back to the page at `here`: a shared publication's, so
 * the person it was shared with lands on it (the R17 plan, R17-A).
 */
function signInAt(here: string, route: string, provider?: string): string {
  const to = here.replace(/^#\//, '');
  const query = new URLSearchParams();
  if (provider !== undefined) query.set('provider', provider);
  if (/^[a-z]+(\/[a-z0-9-]+)*$/.test(to) && to.length <= 200) query.set('to', to);
  const asked = query.toString();
  return asked === '' ? `/v1/sign-in/${route}` : `/v1/sign-in/${route}?${asked}`;
}

/**
 * A link for each way in the environment offers: its organisation's provider, each named where there
 * is more than one (IAM-011), and Google. Links alone, never followed for the person: a provider whose
 * session is live would sign straight back in whoever had just signed out.
 */
export function WaysIn({
  here,
  ways,
  providers,
  className,
}: {
  here: string;
  ways: readonly string[];
  providers: readonly { id: string; name: string }[];
  className: string | undefined;
}): React.JSX.Element {
  const { words } = useWords();
  return (
    <>
      {ways.includes('organisation') && providers.length <= 1 && (
        <a className={className} href={signInAt(here, 'organisation')}>
          {words('shell.signIn')}
        </a>
      )}
      {ways.includes('organisation') &&
        providers.length > 1 &&
        providers.map((provider) => (
          <a
            key={provider.id}
            className={className}
            href={signInAt(here, 'organisation', provider.id)}
          >
            {words('shell.signInThrough', { name: provider.name })}
          </a>
        ))}
      {ways.includes('google') && (
        <a className={className} href={signInAt(here, 'google')}>
          {words('shell.signInGoogle')}
        </a>
      )}
    </>
  );
}
