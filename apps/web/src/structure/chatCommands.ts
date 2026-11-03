import { CONVERSATION_TOOLS, DOCUMENT_CONVERSATION_TOOLS } from '@alloy-works/domain';

import { words } from '../words/words.js';

/**
 * What the assistant's box takes beside an ask: a slash and a word, alone. They never reach the
 * model. A new command is a row here, its words in the catalogue and its act in the panel.
 */
const COMMANDS = {
  clear: () => words('document.command-clear'),
  tools: () => words('document.command-tools'),
  save: () => words('document.command-save'),
  commands: () => words('document.command-commands'),
} as const;

export type ChatCommand = keyof typeof COMMANDS;

const isCommand = (name: string): name is ChatCommand => Object.hasOwn(COMMANDS, name);

/**
 * The command a box's words are, one it does not know, or none: an ask that merely starts with a
 * slash, a path or more words, goes to the model as any other.
 */
export function readCommand(
  text: string,
): { readonly known: ChatCommand } | { readonly unknown: string } | null {
  const trimmed = text.trim();
  if (!/^\/[A-Za-z][\w-]*$/.test(trimmed)) return null;
  const name = trimmed.slice(1).toLowerCase();
  return isCommand(name) ? { known: name } : { unknown: trimmed };
}

/** The commands, as `/commands` lists them. */
export const commandRows = (): readonly (readonly [string, string])[] =>
  Object.entries(COMMANDS).map(([name, says]) => [`/${name}`, says()]);

const TOOL_EFFECTS: Readonly<Record<string, () => string>> = {
  read_outline: () => words('document.tool-read-outline'),
  read_component: () => words('document.tool-read-component'),
  search_document: () => words('document.tool-search-document'),
  search_components: () => words('document.tool-search-components'),
  read_values: () => words('document.tool-read-values'),
  propose_edit: () => words('document.tool-propose-edit'),
  propose_component: () => words('document.tool-propose-component'),
  propose_comment: () => words('document.tool-propose-comment'),
  propose_outline: () => words('document.tool-propose-outline'),
  read_comments: () => words('document.tool-read-comments'),
  read_variables: () => words('document.tool-read-variables'),
  propose_insert: () => words('document.tool-propose-insert'),
  search_references: () => words('document.tool-search-references'),
  read_reference: () => words('document.tool-read-reference'),
  cite_reference: () => words('document.tool-cite-reference'),
  declined: () => words('document.tool-declined'),
};

/** The tools a conversation offers its model, on a document or on none, as `/tools` lists them. */
export const toolRows = (onDocument: boolean): readonly (readonly [string, string])[] =>
  (onDocument ? DOCUMENT_CONVERSATION_TOOLS : CONVERSATION_TOOLS).map((tool) => [
    tool.name,
    TOOL_EFFECTS[tool.name]?.() ?? '',
  ]);
