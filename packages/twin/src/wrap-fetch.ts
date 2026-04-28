import { TwinNoMatchError } from './errors.js';
import { hashRequest } from './hash.js';
import {
  buildRecordedRequest,
  captureResponse,
  extractRequestBody,
  extractRequestHeaders,
  extractRequestMethod,
  extractRequestUrl,
  reconstructResponse,
} from './serialize.js';
import { readRecording, writeRecording } from './store.js';
import type { Recording, TwinMode } from './types.js';

export type { TwinMode } from './types.js';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WrapFetchOptions {
  mode: TwinMode;
  recordingsDir: string;
  hashHeaders?: string[];
}

export function wrapFetch(realFetch: FetchLike, options: WrapFetchOptions): FetchLike {
  const hashHeaders = options.hashHeaders ?? [];

  const wrapped: FetchLike = async (input, init) => {
    const method = extractRequestMethod(input, init);
    const url = extractRequestUrl(input);
    const headers = extractRequestHeaders(input, init);
    const body = await extractRequestBody(input, init);

    const hash = hashRequest({ method, url, body, headers }, { hashHeaders });

    if (options.mode === 'replay') {
      const rec = await readRecording(options.recordingsDir, hash);
      if (rec === null) {
        throw new TwinNoMatchError({ hash, method, url });
      }
      return reconstructResponse(rec.response);
    }

    const realResponse = await realFetch(input, init);
    const recordedResponse = await captureResponse(realResponse);
    const recordedRequest = buildRecordedRequest({
      method,
      url,
      body,
      headers,
      hashHeaders,
    });
    const recording: Recording = {
      version: 1,
      hash,
      recordedAt: new Date().toISOString(),
      request: recordedRequest,
      response: recordedResponse,
    };
    await writeRecording(options.recordingsDir, recording);
    return reconstructResponse(recordedResponse);
  };

  return wrapped;
}
