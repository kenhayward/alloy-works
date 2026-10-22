/**
 * Typings for citeproc-js's CommonJS build, as much of it as the `citations` module uses. The package
 * ships none.
 */
declare module 'citeproc' {
  interface CitationItem {
    readonly id: string;
    readonly locator?: string;
    readonly label?: string;
  }
  interface Citation {
    readonly citationID: string;
    readonly citationItems: readonly CitationItem[];
    readonly properties: { readonly noteIndex: number };
  }
  interface Sys {
    retrieveLocale(language: string): string | undefined;
    retrieveItem(id: string): unknown;
  }
  interface Engine {
    rebuildProcessorState(
      citations: readonly Citation[],
      format: string,
    ): [citationID: string, noteIndex: number, text: string][];
    makeBibliography():
      false | [{ readonly entry_ids: readonly (readonly string[])[] }, readonly string[]];
  }
  interface XmlNode {
    readonly name: string | null;
    readonly attrs: Readonly<Record<string, string>>;
    readonly children: readonly (XmlNode | string)[];
  }
  const CSL: {
    Engine: new (sys: Sys, style: string, language?: string, forceLanguage?: boolean) => Engine;
    parseXml(xml: string): XmlNode;
  };
  export default CSL;
}
