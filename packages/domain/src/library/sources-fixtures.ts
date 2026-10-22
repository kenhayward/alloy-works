/**
 * Invented records in each reference source's own shape (the XR plan, XRa): written by hand from
 * Crossref's REST API and NCBI's E-utilities documentation, every name, title and identifier made up.
 * `10.5555` is Crossref's test prefix; the PMIDs are past any issued. The connector's fake sources
 * answer them, and domain's mappings are tested on them.
 */

/** A journal article as Crossref's `works` answers one. */
export const crossrefMarsh = {
  indexed: { 'date-parts': [[2026, 9, 1]], 'date-time': '2026-09-01T00:00:00Z', timestamp: 0 },
  publisher: 'Invented Estuarine Society',
  issue: '3',
  'short-container-title': ['J. Invent. Estuaries'],
  DOI: '10.5555/marsh.2021.017',
  type: 'journal-article',
  created: { 'date-parts': [[2021, 3, 2]], 'date-time': '2021-03-02T10:00:00Z', timestamp: 0 },
  page: '211-230',
  source: 'Crossref',
  'is-referenced-by-count': 4,
  title: ['Salt Marsh Accretion Under Rising Tides'],
  prefix: '10.5555',
  volume: '48',
  author: [
    {
      given: 'Ada',
      family: 'Marlow',
      sequence: 'first',
      affiliation: [{ name: 'Invented University' }],
    },
    { given: 'Grace', family: 'Penhallow', sequence: 'additional', affiliation: [] },
    { name: 'Tidal Survey Group', sequence: 'additional', affiliation: [] },
  ],
  member: '99999',
  'container-title': ['Journal of Invented Estuaries'],
  language: 'en',
  link: [{ URL: 'https://example.test/marsh.pdf', 'content-type': 'application/pdf' }],
  deposited: { 'date-parts': [[2021, 3, 2]], 'date-time': '2021-03-02T10:00:00Z', timestamp: 0 },
  score: 21.5,
  issued: { 'date-parts': [[2021, 3]] },
  'published-print': { 'date-parts': [[2021, 3]] },
  'references-count': 31,
  URL: 'https://doi.org/10.5555/marsh.2021.017',
  ISSN: ['0000-0019', '0000-0027'],
  'issn-type': [{ value: '0000-0019', type: 'print' }],
  subject: ['Oceanography'],
  abstract: '<jats:p>Invented.</jats:p>',
};

/** A book chapter as Crossref answers one: no issue, an editor, an ISBN. */
export const crossrefChapter = {
  publisher: 'Invented Academic Press',
  DOI: '10.5555/quolls.ch4',
  type: 'book-chapter',
  page: '77-102',
  title: ['Quolls of the Northern Ranges'],
  author: [{ given: 'Ivy', family: 'Thornbury', sequence: 'first', affiliation: [] }],
  editor: [{ given: 'Ada', family: 'Marlow', sequence: 'first', affiliation: [] }],
  'container-title': ['Small Marsupials of the World'],
  'published-online': { 'date-parts': [[2019, 11, 20]] },
  ISBN: ['9781566199094'],
  'publisher-location': 'Invented City',
  URL: 'https://doi.org/10.5555/quolls.ch4',
};

/** Crossref's answer to `GET /works?query=`: a list of works. */
export const crossrefSearch = {
  status: 'ok',
  'message-type': 'work-list',
  'message-version': '1.0.0',
  message: {
    facets: {},
    'total-results': 2,
    items: [crossrefMarsh, crossrefChapter],
    'items-per-page': 20,
    query: { 'start-index': 0, 'search-terms': 'salt marsh' },
  },
};

/** Crossref's answer to `GET /works/{doi}`: one work. */
export const crossrefWork = (work: object = crossrefMarsh) => ({
  status: 'ok',
  'message-type': 'work',
  'message-version': '1.0.0',
  message: work,
});

/** An article as PubMed's `esummary` (retmode=json) answers one. */
export const pubmedDunnart = {
  uid: '99000001',
  pubdate: '2020 May 4',
  epubdate: '2020 Apr 1',
  source: 'J Invent Zool',
  authors: [
    { name: 'Smith A', authtype: 'Author', clusterid: '' },
    { name: 'de Vries GH', authtype: 'Author', clusterid: '' },
  ],
  lastauthor: 'de Vries GH',
  title: 'The dunnart in winter.',
  sorttitle: 'dunnart in winter',
  volume: '12',
  issue: '2',
  pages: '101-9',
  lang: ['eng'],
  nlmuniqueid: '0000001',
  issn: '0000-0035',
  essn: '0000-0043',
  pubtype: ['Journal Article'],
  recordstatus: 'PubMed - indexed for MEDLINE',
  pubstatus: '4',
  articleids: [
    { idtype: 'pubmed', idtypen: 1, value: '99000001' },
    { idtype: 'doi', idtypen: 3, value: '10.5555/dunnart.2020.12' },
    { idtype: 'pmc', idtypen: 8, value: 'PMC9900001' },
  ],
  fulljournalname: 'Journal of Invented Zoology',
  sortpubdate: '2020/05/04 00:00',
  sortfirstauthor: 'Smith A',
};

/** A second, retracted, with no DOI. */
export const pubmedRetracted = {
  uid: '99000002',
  pubdate: '2018',
  source: 'Invent Ecol',
  authors: [{ name: 'Penhallow G', authtype: 'Author', clusterid: '' }],
  title: 'Wombat burrows and soil.',
  volume: '3',
  issue: '',
  pages: '',
  lang: ['eng'],
  issn: '',
  essn: '0000-0051',
  pubtype: ['Journal Article', 'Retracted Publication'],
  articleids: [{ idtype: 'pubmed', idtypen: 1, value: '99000002' }],
  fulljournalname: 'Invented Ecology',
  sortpubdate: '2018/01/01 00:00',
};

/** PubMed's answer to `esearch.fcgi?db=pubmed&retmode=json`: the PMIDs found. */
export const pubmedSearch = {
  header: { type: 'esearch', version: '0.3' },
  esearchresult: {
    count: '2',
    retmax: '2',
    retstart: '0',
    idlist: ['99000001', '99000002'],
    translationset: [],
    querytranslation: 'dunnart[All Fields]',
  },
};

/** PubMed's answer to `esummary.fcgi?db=pubmed&retmode=json` for these records. */
export const pubmedSummary = (records: readonly { readonly uid: string }[]) => ({
  header: { type: 'esummary', version: '0.3' },
  result: {
    uids: records.map((each) => each.uid),
    ...Object.fromEntries(records.map((each) => [each.uid, each])),
  },
});
