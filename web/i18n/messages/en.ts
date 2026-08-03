/**
 * Source of truth for the message shape. `uk.ts` is declared `Messages`, so
 * anything added here must be added there before the build passes.
 *
 * Interpolating strings are functions rather than templates with placeholders:
 * the argument types are then checked at the call site, there is no key-path
 * parser to write, and word order stays the translator's — which matters,
 * because Ukrainian will not follow English order.
 */
const en = {
  app: { name: 'EONYX' },

  nav: {
    dashboard: 'Dashboard',
    newRun: 'New run',
    brands: 'Brands',
    drafts: 'Drafts',
    home: 'EONYX — home',
    theme: 'Toggle theme',
    language: 'Language',
  },

  common: {
    approve: 'Approve',
    requestChanges: 'Request changes',
    none: 'None',
    loading: 'Loading…',
    words: 'Words',
    cost: 'Cost',
    channel: 'Channel',
    brand: 'Brand',
    language: 'Language',
    created: 'Created',
    status: 'Status',
    verdict: 'Verdict',
    topic: 'Topic',
    tone: 'Tone',
    audience: 'Audience',
    wordCount: 'Word count',
    iterations: 'Iterations',
    scores: 'Scores',
    name: 'Name',
  },

  dashboard: {
    title: 'Dashboard',
    newRun: 'New run →',
    drafts: 'Drafts',
    approved: 'Approved',
    approvedHint: (n: { approved: number; total: number }) => `${n.approved} of ${n.total}`,
    totalSpend: 'Total spend',
    avgIterations: 'Avg iterations',
    spendOverTime: 'Spend over time',
    draftsPerChannel: 'Drafts per channel',
    recentDrafts: 'Recent drafts',
    empty: 'Nothing yet.',
    emptyCta: 'Generate your first draft →',
  },

  run: {
    title: 'New run',
    generate: 'Generate',
    running: 'Running…',
    planTitle: 'Content plan — approve?',
    keywords: 'Keywords:',
    tone: 'Tone:',
    audience: 'Audience:',
    feedbackPlaceholder: 'Feedback (required to request changes)',
    conflictsTitle: 'Brief overrides brand guide',
    conflictsNote: "Approving keeps the brief's values.",
    conflictLine: (c: { brief: string; corpus: string }) =>
      `brief: ${c.brief} · brand guide: ${c.corpus}`,
    done: 'Done',
    openDraft: 'Open the finished draft →',
    result: (r: { cost: string; tokens: number }) => `${r.cost} · ${r.tokens} tokens`,
    editorLine: (e: { verdict: string; tone: number; accuracy: number; structure: number }) =>
      `editor: ${e.verdict} · tone ${e.tone} · accuracy ${e.accuracy} · structure ${e.structure}`,
    brandsUnavailable: 'Could not load brands. Every run needs one — check you are signed in, or',
    brandsUnavailableCta: 'ingest a brand',
    noBrands: 'No brands available',
    elapsed: 'elapsed',
    tokens: 'tokens',
    reconnect: 'Reconnect',
    reconnecting: 'Reconnecting…',
  },

  runErrors: {
    serverUnreachable: 'The server was unreachable. The run is still waiting — try again.',
    serverRestarted: 'The server restarted or the run timed out. Start a new run.',
    serverRejected: 'The server rejected the request',
    runFailedTitle: 'Run failed',
    runFailedBody: 'The run failed.',
    connectionLost: 'Connection lost',
    cannotReachTitle: 'Cannot reach the server',
    cannotReachBody: 'Check that the API is running and try again.',
    couldNotStartTitle: 'Could not start the run',
    couldNotStartBody: 'The server accepted the brief but returned no run id.',
    noLongerActive: 'Run no longer active',
    couldNotSubmit: 'Could not submit your decision',
  },

  brands: {
    title: 'Brands',
    newBrand: 'New brand',
    empty: 'No brands yet.',
    emptyCta: 'Ingest one from a website →',
    default: 'default',
    ingesting: 'Ingesting…',
    ingest: 'Ingest brand',
    websiteUrl: 'Website URL',
    websiteHint:
      'The path scopes the crawl: /uk stays inside that section, so a bilingual site does not produce a mixed-language corpus.',
    feed: 'RSS or Atom feed (optional)',
    pasted: 'Pasted posts (optional)',
    pastedHint:
      'Separate posts with a line of three dashes. Real published copy is far better voice evidence than a landing page.',
    needSource: 'Give at least one source: a website, a feed, or pasted posts.',
    reviewTitle: (b: { name: string }) => `${b.name} — approve this brand?`,
    reviewMeta: (b: { language: string; exemplars: number }) =>
      `${b.language} · ${b.exemplars} exemplars`,
    mission: 'Mission',
    voice: 'Voice — one per line',
    forbidden: 'Forbidden phrases — one per line',
    exemplarNote:
      'Exemplars are accepted or re-distilled as a set — a hand-edited exemplar stops being evidence of how the brand actually writes.',
    distilAgain: 'Distil again',
    feedbackPlaceholder: 'Feedback (required to distil again)',
    overview: 'Brand overview',
    styleGuide: 'Style guide',
    exemplars: (n: { count: number }) => `Exemplars (${n.count})`,
    noExemplars: 'None recorded.',
    provenance: 'Provenance',
    provenanceOne: 'source page kept for reference and deliberately not embedded.',
    provenanceMany: 'source pages kept for reference and deliberately not embedded.',
  },

  verdicts: {
    APPROVED: 'Approved',
    REVISION_NEEDED: 'Revision needed',
  },

  drafts: {
    title: 'Drafts',
    empty: 'No drafts yet.',
    emptyCta: 'Generate one →',
    content: 'Content',
    editorIssues: 'Editor issues',
    scoresHint: 'tone / accuracy / structure',
    openNotion: 'Open in Notion →',
    publish: 'Publish to Notion',
    publishing: 'Publishing…',
    copy: 'Copy markdown',
    copied: 'Copied',
    copyFailed: 'Could not copy. Select the text and copy it manually.',
    download: 'Download .md',
  },

  login: {
    title: 'Sign in',
    intro: 'Enter the demo password to continue.',
    password: 'Password',
    checking: 'Checking…',
    submit: 'Enter',
    failed: 'Wrong password.',
  },

  errors: {
    generic: 'Something went wrong.',
    sessionExpired: 'Your session expired. Sign in again to continue.',
    unauthorized: 'You are not signed in.',
    passwordRequired: 'A password is required.',
    invalidPassword: 'Wrong password.',
    brandNotFound: 'That brand no longer exists.',
    brandInactive: 'That brand is unknown or not active yet.',
    brandHasNoSources: 'This brand has no stored sources to re-ingest.',
    brandPasteOnly:
      'This brand has only pasted sources recorded before their text was stored — create it again.',
    brandIsDefault: 'You cannot delete the default brand. Make another brand default first.',
    draftNotFound: 'That draft no longer exists.',
    runNotFound: 'That run no longer exists.',
    runNotAwaiting: 'This run is no longer waiting for approval.',
    notionNotConfigured: 'Notion is not configured on the server.',
    publishFailed: 'Publishing to Notion failed.',
  },
};

export default en;

/**
 * No `as const` on the object above, deliberately. It would make every value a
 * string *literal* type, and `Messages` would then demand the Ukrainian text be
 * byte-identical to the English — which is the opposite of the point.
 */
export type Messages = typeof en;
