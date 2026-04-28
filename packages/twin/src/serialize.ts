import { TwinReplayError } from './errors.js';
import type { RecordedRequest, RecordedResponse } from './types.js';

function describeBody(body: unknown): string {
  if (body !== null && typeof body === 'object') {
    const ctor = (body as { constructor?: { name?: string } }).constructor;
    if (ctor?.name !== undefined && ctor.name !== '') return ctor.name;
  }
  return typeof body;
}

export async function extractRequestBody(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<string | null> {
  if (init !== undefined && 'body' in init && init.body !== undefined) {
    const body = init.body;
    if (body === null) return null;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    throw new TwinReplayError(
      'twin/unsupported-body',
      `request body type not supported: ${describeBody(body)}`,
    );
  }
  if (input instanceof Request) {
    if (input.body === null) return null;
    return await input.clone().text();
  }
  return null;
}

export function extractRequestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return new URL(input).toString();
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function extractRequestMethod(
  input: string | URL | Request,
  init: RequestInit | undefined,
): string {
  const raw = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return raw.toUpperCase();
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

export function extractRequestHeaders(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Record<string, string> {
  const merged = new Headers();
  if (input instanceof Request) {
    for (const [k, v] of input.headers.entries()) merged.set(k, v);
  }
  if (init?.headers !== undefined) {
    const h = new Headers(init.headers);
    for (const [k, v] of h.entries()) merged.set(k, v);
  }
  return headersToRecord(merged);
}

export function buildRecordedRequest(args: {
  method: string;
  url: string;
  body: string | null;
  headers: Record<string, string>;
  hashHeaders: readonly string[];
}): RecordedRequest {
  const subset: Record<string, string> = {};
  if (args.hashHeaders.length > 0) {
    const lowered: Record<string, string> = {};
    for (const [k, v] of Object.entries(args.headers)) {
      lowered[k.toLowerCase()] = v;
    }
    for (const name of args.hashHeaders) {
      const key = name.toLowerCase();
      const value = lowered[key];
      if (value !== undefined) subset[key] = value;
    }
  }
  return {
    method: args.method.toUpperCase(),
    url: args.url,
    headers: subset,
    body: args.body,
  };
}

export async function captureResponse(res: Response): Promise<RecordedResponse> {
  const headers: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) {
    headers[k.toLowerCase()] = v;
  }

  const buf = await res.clone().arrayBuffer();
  if (buf.byteLength === 0) {
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: null,
      bodyEncoding: 'utf8',
    };
  }

  const bytes = new Uint8Array(buf);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: text,
      bodyEncoding: 'utf8',
    };
  } catch {
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: Buffer.from(bytes).toString('base64'),
      bodyEncoding: 'base64',
    };
  }
}

export function reconstructResponse(rec: RecordedResponse): Response {
  let body: string | Uint8Array | null = null;
  if (rec.body !== null) {
    if (rec.bodyEncoding === 'base64') {
      body = Buffer.from(rec.body, 'base64');
    } else {
      body = rec.body;
    }
  }
  return new Response(body, {
    status: rec.status,
    statusText: rec.statusText,
    headers: rec.headers,
  });
}
