export type TwinMode = 'record' | 'replay';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface RecordedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding: 'utf8' | 'base64';
}

export interface Recording {
  version: 1;
  hash: string;
  recordedAt: string;
  request: RecordedRequest;
  response: RecordedResponse;
}
