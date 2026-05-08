#!/bin/bash
# fake-bun.sh — emulates `bun test` output for v0.0.13/v0.0.14 runner tests.
#
# Invoked as: fake-bun.sh test <file> [-t <pattern>]
# Mode is selected from the file argument's substring:
#   coverage-trip   → `0 fail` + threshold marker, exit 1
#   clean-pass      → `0 fail`, no marker, exit 0
#   no-marker       → `0 fail`, no marker, exit 1 (e.g. unrelated nonzero exit)
#   real-fail       → `1 fail`, real test failure, exit 1
#   regex-no-match  → bun's `regex "<pat>" matched 0 tests` shape, exit 1
#   regex-no-match-with-coverage → both regex-no-match AND coverage marker
#                                  (coverage-trip path takes precedence)

file="$2"
pattern=""
if [ "$3" = "-t" ]; then
  pattern="$4"
fi

case "$file" in
  *regex-no-match-with-coverage*)
    echo " 1 pass"
    echo " 0 fail"
    echo "coverage threshold of 0.8 not met (lines: 0.20)"
    echo "regex \"$pattern\" matched 0 tests"
    exit 1
    ;;
  *regex-no-match*)
    echo " 0 pass"
    echo " 0 fail"
    echo "regex \"$pattern\" matched 0 tests"
    exit 1
    ;;
  *coverage-trip*)
    echo " 1 pass"
    echo " 0 fail"
    echo "coverage threshold of 0.8 not met (lines: 0.20)"
    exit 1
    ;;
  *clean-pass*)
    echo " 1 pass"
    echo " 0 fail"
    exit 0
    ;;
  *no-marker*)
    echo " 1 pass"
    echo " 0 fail"
    echo "internal error: bun crashed for unrelated reason"
    exit 1
    ;;
  *real-fail*)
    echo " 0 pass"
    echo " 1 fail"
    echo "fail) test 'foo' did not match expected"
    exit 1
    ;;
  *)
    echo "fake-bun: unknown mode for file=$file" >&2
    exit 99
    ;;
esac
