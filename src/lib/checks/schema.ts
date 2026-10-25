import type { Finding } from '../types';

// JSON-LD reading and the Google rich-result property lists that matter most. The lists follow
// Google Search Central's structured data docs; they are a quick check, not a full validator,
// so the tab links to the Rich Results Test and the Schema.org validator for the full answer.

export type JsonObject = Record<string, unknown>;

export interface SchemaItem {
  type: string;
  props: { name: string; value: string; level: 'good' | 'warn' | 'bad' }[];
  eligible: boolean | null; // null: no rich result for this type
  data: JsonObject;
}

const RULES: Record<string, { required: string[]; recommended: string[] }> = {
  Article: {
    required: ['headline'],
    recommended: ['image', 'datePublished', 'dateModified', 'author.name', 'author.url'],
  },
  NewsArticle: {
    required: ['headline'],
    recommended: ['image', 'datePublished', 'dateModified', 'author.name'],
  },
  BlogPosting: {
    required: ['headline'],
    recommended: ['image', 'datePublished', 'dateModified', 'author.name'],
  },
  Product: {
    required: ['name'],
    recommended: ['image', 'offers', 'review', 'aggregateRating', 'brand', 'sku'],
  },
  Offer: { required: ['price', 'priceCurrency'], recommended: ['availability'] },
  BreadcrumbList: { required: ['itemListElement'], recommended: [] },
  FAQPage: { required: ['mainEntity'], recommended: [] },
  Recipe: {
    required: ['name', 'image'],
    recommended: [
      'author',
      'datePublished',
      'recipeIngredient',
      'recipeInstructions',
      'totalTime',
      'aggregateRating',
    ],
  },
  Event: {
    required: ['name', 'startDate', 'location'],
    recommended: ['endDate', 'image', 'offers', 'eventStatus', 'organizer'],
  },
  LocalBusiness: {
    required: ['name', 'address'],
    recommended: ['telephone', 'openingHoursSpecification', 'geo', 'url', 'priceRange'],
  },
  Organization: { required: [], recommended: ['name', 'logo', 'url', 'sameAs'] },
  WebSite: { required: [], recommended: ['name', 'url'] },
  VideoObject: {
    required: ['name', 'thumbnailUrl', 'uploadDate'],
    recommended: ['description', 'duration', 'contentUrl'],
  },
  JobPosting: {
    required: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'],
    recommended: ['validThrough', 'baseSalary', 'employmentType'],
  },
  Review: { required: ['itemReviewed', 'reviewRating', 'author'], recommended: [] },
  SoftwareApplication: {
    required: ['name', 'offers'],
    recommended: ['aggregateRating', 'operatingSystem', 'applicationCategory'],
  },
  Course: { required: ['name', 'description'], recommended: ['provider'] },
  HowTo: { required: ['name', 'step'], recommended: [] },
};

const RICH = new Set(
  Object.keys(RULES).filter((t) => !['Organization', 'WebSite', 'Offer'].includes(t)),
);

function get(obj: JsonObject, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (Array.isArray(cur)) cur = cur[0];
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as JsonObject)[key];
  }
  return cur;
}

function show(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v))
    return v.length ? `${show(v[0])}${v.length > 1 ? ` (+${v.length - 1})` : ''}` : '';
  const o = v as JsonObject;
  return show(o.name ?? o['@id'] ?? o.url ?? o['@type'] ?? JSON.stringify(o).slice(0, 80));
}

const typesOf = (o: JsonObject) => {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.split('/').pop()!);
};

/** Flattens scripts, arrays and @graph into the list of typed top-level entities. */
export function parseJsonLd(scripts: string[]): { items: JsonObject[]; errors: string[] } {
  const items: JsonObject[] = [];
  const errors: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as JsonObject;
      if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(walk);
      if (o['@type']) items.push(o);
    }
  };
  for (const src of scripts) {
    // Old CMS templates wrap the JSON in an HTML comment or CDATA section, which browsers and
    // Google ignore. Trailing commas and other invalid JSON stay errors: Google rejects them.
    const json = src
      .trim()
      .replace(/^(?:\/\/\s*)?(?:<!--|<!\[CDATA\[)/, '')
      .replace(/(?:\/\/\s*)?(?:-->|\]\]>)$/, '')
      .trim();
    if (!json) continue;
    try {
      walk(JSON.parse(json));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { items, errors };
}

export function analyseSchema(scripts: string[]): {
  items: SchemaItem[];
  errors: string[];
  findings: Finding[];
} {
  const { items: raw, errors } = parseJsonLd(scripts);
  const items = raw.map((data): SchemaItem => {
    const type = typesOf(data).find((t) => RULES[t]) ?? typesOf(data)[0] ?? 'Thing';
    const rule = RULES[type];
    if (!rule) return { type, props: [], eligible: null, data };
    const props = [
      ...rule.required.map((name) => ({
        name,
        value: show(get(data, name)),
        level: get(data, name) == null ? ('bad' as const) : ('good' as const),
      })),
      ...rule.recommended.map((name) => ({
        name,
        value: show(get(data, name)),
        level: get(data, name) == null ? ('warn' as const) : ('good' as const),
      })),
    ];
    return {
      type,
      props,
      eligible: RICH.has(type) ? !props.some((p) => p.level === 'bad') : null,
      data,
    };
  });
  const findings: Finding[] = [];
  if (errors.length)
    findings.push({ id: 'schema.parseError', level: 'bad', params: { n: errors.length } });
  if (!items.length && !errors.length) findings.push({ id: 'schema.none', level: 'info' });
  const missing = items.filter((i) => i.eligible === false).length;
  if (missing)
    findings.push({ id: 'schema.requiredMissing', level: 'bad', params: { n: missing } });
  const warnings = items.reduce((n, i) => n + i.props.filter((p) => p.level === 'warn').length, 0);
  if (warnings)
    findings.push({ id: 'schema.recommendedMissing', level: 'warn', params: { n: warnings } });
  return { items, errors, findings };
}
