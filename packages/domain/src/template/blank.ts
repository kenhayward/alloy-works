import {
  TEMPLATE_SCHEMA_VERSION,
  templateDefinitionSchema,
  type TemplateDefinition,
} from './definition.js';

/** The words Blank is made with: its name, and its one component's title and text (ND-F). */
export interface BlankWords {
  readonly name: string;
  readonly title: string;
  readonly text: string;
}

/** Blank's words in en-GB, the catalogue's fallback (the ND plan, ND-F). */
export const BLANK_WORDS: BlankWords = {
  name: 'Blank',
  title: 'Please supply a title',
  text: 'Please supply the text.',
};

/** Blank's one paragraph, fixed: a copy is a new component, so its identifier is unique there. */
const PARAGRAPH = 'blankparagraphaaaaaaaaaaaa';

/**
 * **Blank** (TPL-074; the ND plan, ND-A, ND-F): every space's default template until another is chosen.
 * No starting section; one component, held as content and so copied, not required, at the top of the
 * body: a title and one paragraph asking for them. Its theme and layout are the tenant's defaults,
 * given. Parsed, so it is held to every rule a stored template is.
 */
export function blankTemplate(
  words: BlankWords,
  theme: string,
  layout: string,
): TemplateDefinition {
  return templateDefinitionSchema.parse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: words.name,
    theme,
    layout,
    schemas: [],
    outline: { sections: [] },
    changes: { add: true, remove: true, reorder: true },
    components: [
      {
        key: 'text',
        content: {
          title: words.title,
          blocks: [
            {
              type: 'paragraph',
              id: PARAGRAPH,
              style: 'body',
              content: [{ type: 'text', value: words.text, marks: [] }],
            },
          ],
        },
        required: false,
        place: { section: null, at: 'start' },
      },
    ],
  });
}
