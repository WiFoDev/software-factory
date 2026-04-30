import { expect, test } from 'bun:test';
import { slugify } from './slugify';

test('lowercases and joins words with a single dash', () => {
  expect(slugify('Hello World')).toBe('hello-world');
});

test('collapses any run of non-alphanumerics to a single dash', () => {
  expect(slugify('Foo!!!  @@@  Bar')).toBe('foo-bar');
});

test('trims leading and trailing dashes', () => {
  expect(slugify('  --Hello, World!--  ')).toBe('hello-world');
});

test('preserves digits', () => {
  expect(slugify('Test Case 42!')).toBe('test-case-42');
});

test('returns empty string when input has no alphanumerics', () => {
  expect(slugify('')).toBe('');
  expect(slugify('!!!')).toBe('');
});
