export interface Stargazer {
  login: string;
  html_url: string;
}

export interface GetStargazersOptions {
  ttlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class GhStarsRateLimitError extends Error {
  override name = 'GhStarsRateLimitError';
  resetAt: Date;

  constructor(resetAt: Date) {
    super(
      `GitHub API rate limit exceeded. Try again after ${resetAt.toISOString()} (${resetAt.toLocaleString()}).`,
    );
    this.resetAt = resetAt;
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const RETRY_BACKOFF_MS = [100, 200] as const;

interface CacheEntry {
  fetchedAt: number;
  data: Stargazer[];
  etag?: string;
}

const cache = new Map<string, CacheEntry>();

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1] ?? null;
  }
  return null;
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;
  let lastStatus = 0;
  let lastStatusText = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchImpl(url, init);
    if (res.status < 500 || res.status >= 600) {
      return res;
    }
    lastStatus = res.status;
    lastStatusText = res.statusText || 'Service Unavailable';
    if (attempt < maxAttempts - 1) {
      const backoff = RETRY_BACKOFF_MS[attempt];
      if (backoff !== undefined) {
        await sleep(backoff);
      }
    }
  }
  throw new Error(
    `GitHub API request failed after ${maxAttempts} attempts (${RETRY_BACKOFF_MS.length} retries): last status ${lastStatus} ${lastStatusText}. Exhausted retries on transient 5xx response.`,
  );
}

export async function getStargazers(
  repo: string,
  opts: GetStargazersOptions = {},
): Promise<Stargazer[]> {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new Error(`Invalid repo "${repo}": expected format "<owner>/<repo>".`);
  }

  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  const cached = cache.get(repo);
  const currentTime = now();
  if (cached && currentTime - cached.fetchedAt < ttlMs) {
    return cached.data;
  }

  const baseHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'gh-stars-example',
  };

  const firstHeaders: Record<string, string> = { ...baseHeaders };
  if (cached?.etag) {
    firstHeaders['If-None-Match'] = cached.etag;
  }

  const firstUrl = `https://api.github.com/repos/${repo}/stargazers`;
  const firstRes = await fetchWithRetry(firstUrl, { headers: firstHeaders }, fetchImpl, sleep);

  if (firstRes.status === 304 && cached) {
    cache.set(repo, { ...cached, fetchedAt: currentTime });
    return cached.data;
  }

  if (firstRes.status === 403 && firstRes.headers.get('x-ratelimit-remaining') === '0') {
    const resetHeader = firstRes.headers.get('x-ratelimit-reset');
    const resetSeconds = resetHeader ? Number(resetHeader) : Number.NaN;
    const resetAt = Number.isFinite(resetSeconds)
      ? new Date(resetSeconds * 1000)
      : new Date(currentTime);
    throw new GhStarsRateLimitError(resetAt);
  }

  if (!firstRes.ok) {
    throw new Error(`GitHub API request failed: ${firstRes.status} ${firstRes.statusText}`);
  }

  const firstBody = (await firstRes.json()) as Stargazer[];
  const all: Stargazer[] = firstBody.map((s) => ({
    login: s.login,
    html_url: s.html_url,
  }));

  let nextUrl = parseNextLink(firstRes.headers.get('Link'));
  while (nextUrl) {
    const pageRes = await fetchWithRetry(nextUrl, { headers: baseHeaders }, fetchImpl, sleep);
    if (!pageRes.ok) {
      throw new Error(`GitHub API request failed: ${pageRes.status} ${pageRes.statusText}`);
    }
    const pageBody = (await pageRes.json()) as Stargazer[];
    if (!pageBody.length) break;
    for (const s of pageBody) {
      all.push({ login: s.login, html_url: s.html_url });
    }
    nextUrl = parseNextLink(pageRes.headers.get('Link'));
  }

  const newEtag = firstRes.headers.get('ETag') ?? undefined;
  cache.set(repo, { fetchedAt: currentTime, data: all, etag: newEtag });
  return all;
}

export function __clearCache(): void {
  cache.clear();
}
