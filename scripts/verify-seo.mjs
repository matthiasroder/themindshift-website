import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const dist = join(root, 'dist');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function htmlFor(route) {
  const relativePath = route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`;
  return readFileSync(join(dist, relativePath), 'utf8');
}

function jsonLdTypes(html) {
  const types = [];

  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(match[1]);
      const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value['@type']) types.push(value['@type']);
        Object.values(value).forEach(visit);
      };
      visit(data);
    } catch {
      failures.push('Invalid JSON-LD found in generated HTML');
    }
  }

  return types;
}

const htmlFiles = walk(dist).filter((file) => file.endsWith('.html'));
const indexableFiles = htmlFiles.filter((file) => !file.endsWith(`${sep}writings${sep}index.html`));
const canonicalURLs = new Set();
const titles = new Map();

for (const file of indexableFiles) {
  const html = readFileSync(file, 'utf8');
  const route = relative(dist, file).replaceAll(sep, '/');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const title = html.match(/<title>(.*?)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  const h1Count = (html.match(/<h1\b/g) ?? []).length;

  assert(Boolean(canonical), `${route}: missing canonical`);
  assert(canonical?.startsWith('https://themindshift.global/'), `${route}: invalid canonical`);
  assert(Boolean(title), `${route}: missing title`);
  assert(Boolean(description), `${route}: missing meta description`);
  assert(h1Count === 1, `${route}: expected one H1, found ${h1Count}`);
  assert(!title?.includes('The Mindshift — The Mindshift'), `${route}: duplicate brand in title`);

  if (canonical) canonicalURLs.add(canonical);
  if (title) {
    const previous = titles.get(title);
    assert(!previous, `${route}: duplicate title also used by ${previous}`);
    titles.set(title, route);
  }

  jsonLdTypes(html);
}

const expectedSchema = [
  ['/', ['WebSite', 'Organization']],
  ['/about', ['ProfilePage', 'Person']],
  ['/faq', ['FAQPage']],
  ['/insights/execution-is-collapsing', ['Article']],
  ['/insights/ideas-are-everything', ['Article']],
  ['/insights/the-earned-autonomy-gradient', ['Article']],
  ['/insights/the-future-is-ambient-ai', ['Article']],
  ['/insights/the-halo-organization', ['Article']]
];

for (const [route, expectedTypes] of expectedSchema) {
  const types = jsonLdTypes(htmlFor(route));
  for (const type of expectedTypes) {
    assert(types.includes(type), `${route}: missing ${type} schema`);
  }
}

const sitemapIndex = readFileSync(join(dist, 'sitemap-index.xml'), 'utf8');
const sitemapName = sitemapIndex.match(/<loc>https:\/\/themindshift\.global\/([^<]+)<\/loc>/)?.[1];
assert(Boolean(sitemapName), 'sitemap-index.xml: missing child sitemap');

if (sitemapName) {
  const sitemap = readFileSync(join(dist, sitemapName), 'utf8');
  const sitemapURLs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));

  assert(!sitemapURLs.has('https://themindshift.global/writings/'), 'Sitemap includes legacy redirect');
  for (const canonical of canonicalURLs) {
    assert(sitemapURLs.has(canonical), `Sitemap missing ${canonical}`);
  }
}

const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
assert(robots.includes('Sitemap: https://themindshift.global/sitemap-index.xml'), 'robots.txt: missing sitemap URL');

const writings = htmlFor('/writings');
assert(writings.includes('http-equiv="refresh"'), '/writings: missing redirect');
assert(writings.includes('https://themindshift.global/insights/'), '/writings: invalid redirect target');

const allHTML = htmlFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
assert(allHTML.includes('data-conversion="ai-workflow-scan"'), 'Missing AI Workflow Scan tracking hooks');
assert(allHTML.includes('data-conversion="ai-workflow-scan-call"'), 'Missing AI Workflow Scan call tracking hook');
assert(allHTML.includes('data-conversion="ai-workflow-scan-email"'), 'Missing AI Workflow Scan email tracking hook');

if (failures.length) {
  console.error(`SEO verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`SEO verification passed for ${indexableFiles.length} indexable pages.`);
