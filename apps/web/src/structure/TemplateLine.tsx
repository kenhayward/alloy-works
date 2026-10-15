/** The template a document was made from, as its view gives it (templates.md; the WF6 plan, WF6-A). */
export interface TemplateInfo {
  readonly id: string;
  readonly name: string;
  readonly version: { readonly id: string; readonly number: string };
  /** The keys of the starting sections it requires (TPL-029). */
  readonly required: readonly string[];
  readonly departures: {
    readonly added: readonly { readonly node: string; readonly title: string }[];
    readonly missing: readonly {
      readonly key: string;
      readonly title: string;
      readonly required: boolean;
      readonly reason: string | null;
    }[];
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A view's `template`, read defensively: null for none, or one from a service before WF6. */
export function templateIn(value: unknown): TemplateInfo | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string')
    return null;
  const version = isRecord(value.version) ? value.version : {};
  const departures = isRecord(value.departures) ? value.departures : {};
  const list = (items: unknown) => (Array.isArray(items) ? items.filter(isRecord) : []);
  return {
    id: value.id,
    name: value.name,
    version: {
      id: typeof version.id === 'string' ? version.id : '',
      number: typeof version.number === 'string' ? version.number : '',
    },
    required: Array.isArray(value.required)
      ? value.required.filter((each): each is string => typeof each === 'string')
      : [],
    departures: {
      added: list(departures.added).map((each) => ({
        node: String(each.node),
        title: String(each.title),
      })),
      missing: list(departures.missing).map((each) => ({
        key: String(each.key),
        title: String(each.title),
        required: each.required === true,
        reason: typeof each.reason === 'string' ? each.reason : null,
      })),
    },
  };
}

/**
 * Which template the document was made from, and how it departs from it (TPL-028): each section it
 * has that its template does not, and each it lacks, with the reason a required one was removed for.
 */
export function TemplateLine({
  template,
  className,
}: {
  template: TemplateInfo;
  className?: string | undefined;
}) {
  const { added, missing } = template.departures;
  return (
    <div className={className}>
      <p>{`Made from ${template.name}, version ${template.version.number}`}</p>
      {added.length + missing.length > 0 && (
        <ul aria-label={`Departures from ${template.name}`}>
          {added.map((each) => (
            <li key={each.node}>{`${each.title || 'A section'} is not in the template.`}</li>
          ))}
          {missing.map((each) => (
            <li key={each.key}>
              {each.required
                ? each.reason === null
                  ? `${each.title}, which the template requires, is missing.`
                  : `${each.title}, which the template requires, was removed: ${each.reason}`
                : `${each.title} is not here.`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
