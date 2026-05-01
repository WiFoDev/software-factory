// Parse a human-readable size string into bytes.
//
// Examples:
//   parseSize("1.5 KB")  → 1500     (SI, base 1000)
//   parseSize("3.5 GiB") → 3758096384 (IEC, base 1024)
//   parseSize("1024")    → 1024     (raw bytes)

const SI_UNITS: Record<string, number> = {
  '': 1,
  k: 1e3,
  kb: 1e3,
  m: 1e6,
  mb: 1e6,
  g: 1e9,
  gb: 1e9,
  t: 1e12,
  tb: 1e12,
};

const IEC_UNITS: Record<string, number> = {
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

const KNOWN_UNITS = [
  '(bare)',
  'K',
  'KB',
  'KiB',
  'M',
  'MB',
  'MiB',
  'G',
  'GB',
  'GiB',
  'T',
  'TB',
  'TiB',
].join(', ');

const NUMBER_AND_UNIT = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/;

export function parseSize(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new Error('parseSize: empty input');
  }
  const match = NUMBER_AND_UNIT.exec(trimmed);
  if (match === null) {
    throw new Error(`parseSize: could not parse a number from '${text}'`);
  }
  const numStr = match[1];
  const unitRaw = match[2];
  if (numStr === undefined || unitRaw === undefined) {
    throw new Error(`parseSize: could not parse a number from '${text}'`);
  }
  const value = Number.parseFloat(numStr);
  if (value < 0) {
    throw new Error('parseSize: negative byte count not allowed');
  }
  const unit = unitRaw.toLowerCase();
  // IEC takes precedence — the suffix "iB" (case-folded "ib") only matches IEC entries.
  const multiplier = IEC_UNITS[unit] ?? SI_UNITS[unit];
  if (multiplier === undefined) {
    throw new Error(`parseSize: unrecognized unit '${unitRaw}' (expected one of: ${KNOWN_UNITS})`);
  }
  return Math.round(value * multiplier);
}
