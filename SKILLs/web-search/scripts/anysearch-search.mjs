#!/usr/bin/env node

const [queryArg, maxResultsArg] = process.argv.slice(2);
const query = queryArg?.trim();
const maxResults = Number.parseInt(maxResultsArg ?? '10', 10);
const gatewayUrl = (process.env.ZHIYUAN_ANYSEARCH_GATEWAY_URL || 'https://search.rongxzyai.com').replace(/\/$/, '');
const token = process.env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN;

if (!query || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) {
  console.error('web-search requires a query and max_results between 1 and 20.');
  process.exit(2);
}

if (!token) {
  console.error('Internal web search is unavailable because its gateway credential is not configured.');
  process.exit(1);
}

const markdown = (value) => String(value ?? '').replace(/[\[\]]/g, '\\$&').replace(/\r?\n+/g, ' ').trim();

try {
  const response = await fetch(`${gatewayUrl}/v1/search`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, max_results: maxResults }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `gateway returned HTTP ${response.status}`;
    console.error(`Internal web search failed: ${message}`);
    process.exit(1);
  }

  const results = Array.isArray(payload?.data?.results) ? payload.data.results : [];
  const total = payload?.data?.metadata?.total_results ?? results.length;
  const elapsed = payload?.data?.metadata?.search_time_ms;
  console.log(`# Search Results: ${query}\n`);
  console.log(`**Results:** ${total}${elapsed === undefined ? '' : `  \n**Time:** ${elapsed}ms`}\n\n---\n`);
  for (const result of results) {
    const title = markdown(result.title) || 'Untitled result';
    const url = String(result.url ?? '').trim();
    const snippet = markdown(result.snippet || result.content);
    console.log(`## ${title}\n`);
    if (url) console.log(`**URL:** [${url}](${url})\n`);
    if (snippet) console.log(`${snippet}\n`);
    console.log('---\n');
  }
} catch (error) {
  console.error(`Internal web search failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
