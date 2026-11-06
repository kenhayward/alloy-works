/**
 * What New document's gallery offers (the ND plan, ND-H, ND-I): each template the reader may use,
 * with the summary `GET /v1/templates` gives, grouped by space, the space chosen for Where first.
 * Pure, so the order and the filter are tested apart from the dialog.
 */
export interface TemplateOffer {
  /** Null for a space's Blank not yet made: the service makes it when a document asks for it (ND-N). */
  readonly id: string | null;
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly description: string | null;
  readonly sections: number;
  readonly values: number;
  readonly requiredValues: number;
  readonly copied: number;
  readonly referenced: number;
  readonly headings: readonly string[];
  readonly isDefault: boolean;
}

export interface OfferGroup {
  readonly space: { readonly id: string; readonly name: string };
  readonly offers: readonly TemplateOffer[];
}

/** One key for an offer, the made-later Blank included. */
export const offerKey = (offer: TemplateOffer): string => offer.id ?? `blank-${offer.space.id}`;

/** A space's Blank as it will be made: one copied component and nothing to give. */
export const blankOffer = (
  space: { readonly id: string; readonly name: string },
  name: string,
): TemplateOffer => ({
  id: null,
  name,
  space,
  description: null,
  sections: 0,
  values: 0,
  requiredValues: 0,
  copied: 1,
  referenced: 0,
  headings: [],
  isDefault: true,
});

/** The offers with the Where space's Blank added where it has no default yet. */
export function withBlank(
  offers: readonly TemplateOffer[],
  where: { readonly id: string; readonly name: string } | undefined,
  blankName: string,
): readonly TemplateOffer[] {
  if (where === undefined) return offers;
  const hasDefault = offers.some((each) => each.space.id === where.id && each.isDefault);
  return hasDefault ? offers : [blankOffer(where, blankName), ...offers];
}

/**
 * The offers by space: Where's first, then the spaces in the order the reader's spaces come, then
 * any other by name; in each, its default first, the rest as listed. `find` keeps an offer whose name
 * or space's name holds it, ignoring case, and a group left empty is dropped.
 */
export function galleryGroups(
  offers: readonly TemplateOffer[],
  where: string,
  spaceOrder: readonly string[],
  find: string,
): OfferGroup[] {
  const sought = find.trim().toLocaleLowerCase();
  const kept = offers.filter(
    (each) =>
      sought === '' ||
      each.name.toLocaleLowerCase().includes(sought) ||
      each.space.name.toLocaleLowerCase().includes(sought),
  );
  const groups = new Map<string, { space: OfferGroup['space']; offers: TemplateOffer[] }>();
  for (const each of kept) {
    const group = groups.get(each.space.id) ?? { space: each.space, offers: [] };
    group.offers.push(each);
    groups.set(each.space.id, group);
  }
  const rank = (id: string) => {
    if (id === where) return -1;
    const at = spaceOrder.indexOf(id);
    return at < 0 ? spaceOrder.length : at;
  };
  return [...groups.values()]
    .sort((a, b) => rank(a.space.id) - rank(b.space.id) || a.space.name.localeCompare(b.space.name))
    .map((group) => ({
      space: group.space,
      offers: [...group.offers].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
    }));
}

/** The offer a space starts with chosen: its default, or its Blank. */
export function defaultOffer(
  offers: readonly TemplateOffer[],
  where: string,
): TemplateOffer | undefined {
  return offers.find((each) => each.space.id === where && each.isDefault);
}

/**
 * A space's tone, one of four, stable by its id rather than its place in a list (ND-L): it tells
 * spaces apart and says nothing else, and the space's name is always shown beside it.
 */
export function toneOf(space: string): 0 | 1 | 2 | 3 {
  let hash = 0;
  for (const char of space) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 4) as 0 | 1 | 2 | 3;
}
