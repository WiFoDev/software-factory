import type { ZodIssue } from 'zod';

export type ContextErrorCode =
  | 'context/unregistered-type'
  | 'context/duplicate-registration'
  | 'context/schema-validation-failed'
  | 'context/parent-missing'
  | 'context/io-error'
  | 'context/parse-error'
  | 'context/version-mismatch';

export interface ContextErrorOptions {
  issues?: ZodIssue[];
  missingParent?: string;
}

export class ContextError extends Error {
  readonly code: ContextErrorCode;
  readonly issues?: ZodIssue[];
  readonly missingParent?: string;

  constructor(code: ContextErrorCode, message: string, options: ContextErrorOptions = {}) {
    super(`${code}: ${message}`);
    this.name = 'ContextError';
    this.code = code;
    if (options.issues !== undefined) this.issues = options.issues;
    if (options.missingParent !== undefined) this.missingParent = options.missingParent;
  }
}
