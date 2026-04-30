export interface Stargazer {
  login: string;
  html_url: string;
}

export interface GetStargazersOptions {
  ttlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
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

interface CacheEntry {
  fetchedAt: number;
  data: Stargazer[];
}

const cache = new Map<string, CacheEntry>();

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

export async function getStargazers(
  repo: string,
  opts: GetStargazersOptions = {},
): Promise<Stargazer[]> {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new Error(
      `Invalid repo "${repo}": expected format "<owner>/<repo>".`,
    );
  }

  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;

  const cached = cache.get(repo);
  const currentTime = now();
  if (cached && currentTime - cached.fetchedAt < ttlMs) {
    return cached.data;
  }

  const url = `https://api.github.com/repos/${repo}/stargazers`;
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gh-stars-example',
    },
  });

  if (
    res.status === 403 &&
    res.headers.get('x-ratelimit-remaining') === '0'
  ) {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    const resetSeconds = resetHeader ? Number(resetHeader) : Number.NaN;
    const resetAt = Number.isFinite(resetSeconds)
      ? new Date(resetSeconds * 1000)
      : new Date(currentTime);
    throw new GhStarsRateLimitError(resetAt);
  }

  if (!res.ok) {
    throw new Error(
      `GitHub API request failed: ${res.status} ${res.statusText}`,
    );
  }

  const body = (await res.json()) as Stargazer[];
  const data: Stargazer[] = body.map((s) => ({
    login: s.login,
    html_url: s.html_url,
  }));

  cache.set(repo, { fetchedAt: currentTime, data });
  return data;
}

export function __clearCache(): void {
  cache.clear();
}
