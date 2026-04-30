export interface ContextRecord {
  version: 1;
  id: string;
  type: string;
  recordedAt: string;
  parents: string[];
  payload: unknown;
}
