const LABEL_PATTERN = /(?:^|[^A-Z0-9])(?:S\s*[\\/]?\s*N|SN|SERIAL(?:\s*(?:NO|NUMBER|#))?|SER\s*NO|S[AY]?N[EFY]?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{4,24})/gi;
const TOKEN_PATTERN = /[A-Z0-9]{6,24}/g;
const KNOWN_MODEL_PREFIXES = ['MTM', 'MODEL', 'ADID', 'MO', 'MFG', 'DATE', 'INPUT', 'FACTORY'];
const AMBIGUOUS_ZERO = /[OQDG]/;
const AMBIGUOUS_NINE = /[SOGQ]/;

function cleanToken(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^(?:SN|SNO|SERIALNO|SERIALNUMBER|SAN|SANE|SANY|SYN)/, '')
    .slice(0, 24);
}

function isPlausible(token) {
  if (token.length < 6 || token.length > 20) return false;
  if (!/[A-Z]/.test(token) || !/\d/.test(token)) return false;
  if (/^(?:20\d{6}|19\d{6})$/.test(token)) return false;
  if (/^(?:V|W|A)?\d{6,}$/.test(token)) return false;
  if (KNOWN_MODEL_PREFIXES.some((prefix) => token.startsWith(prefix))) return false;
  return true;
}

function scoreToken(token, context, labelMatch = false) {
  let score = labelMatch ? 130 : 0;
  if (token.length === 8) score += 45;
  else if (token.length === 10) score += 18;
  else if (token.length >= 7 && token.length <= 12) score += 12;
  if (/^[A-Z]{1,3}\d/.test(token)) score += 8;
  if (/\d[A-Z]/.test(token)) score += 5;
  if (/S\s*[\\/]?\s*N|SERIAL|S[AY]?N/i.test(context)) score += 25;
  if (/MTM|MODEL|MFG|DATE|INPUT|FACTORY/i.test(context)) score -= 40;
  if (/82W2|KUS|20V|325A/.test(token)) score -= 35;
  return score;
}

function addCandidate(map, token, score) {
  const cleaned = cleanToken(token);
  if (!isPlausible(cleaned)) return;
  map.set(cleaned, Math.max(map.get(cleaned) || -Infinity, score));
}

function lenovoSerialVariants(rawToken) {
  const raw = String(rawToken || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const seeds = new Set();
  if (raw.length >= 6 && raw.length <= 12) seeds.add(raw);
  for (const length of [8, 9]) {
    if (raw.length > length) seeds.add(raw.slice(-length));
  }

  const variants = new Map();
  const add = (value, bonus) => {
    if (value.length >= 6 && value.length <= 12) {
      variants.set(value, Math.max(variants.get(value) || -Infinity, bonus));
    }
  };

  for (const seed of seeds) {
    add(seed, 0);
    let compact = seed;
    let compactBonus = 0;

    // OCR often inserts O/0 before the final letter on Lenovo labels.
    if (compact.length === 9 && /[A-Z]/.test(compact.at(-1)) && /[OQ0]/.test(compact.at(-2))) {
      compact = compact.slice(0, -2) + compact.at(-1);
      compactBonus = 34;
      add(compact, compactBonus);
    }

    if (compact.length === 8) {
      const chars = [...compact];
      if (AMBIGUOUS_ZERO.test(chars[2])) {
        const corrected = [...chars];
        corrected[2] = '0';
        add(corrected.join(''), compactBonus + 42);
        chars[2] = '0';
      }

      if (AMBIGUOUS_NINE.test(chars[6])) {
        const nine = [...chars];
        nine[6] = '9';
        add(nine.join(''), compactBonus + (compact.endsWith('T') ? 48 : 31));

        const zero = [...chars];
        zero[6] = '0';
        add(zero.join(''), compactBonus + 24);
      }

      add(chars.join(''), compactBonus + 36);
    }
  }

  return [...variants.entries()].map(([value, bonus]) => ({ value, bonus }));
}

export function extractSerialCandidates(rawText) {
  const normalized = String(rawText || '')
    .toUpperCase()
    .replace(/[|]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/\r/g, '\n');
  const candidates = new Map();
  const lenovoHint = /LENOVO|MTM\s*[:#-]?\s*82|ADID/.test(normalized);

  let match;
  LABEL_PATTERN.lastIndex = 0;
  while ((match = LABEL_PATTERN.exec(normalized))) {
    const chunk = match[1].split(/\n|\s{2,}|\b(?:MTM|MODEL|ADID|MFG|DATE|INPUT|FACTORY)\b/)[0];
    const token = cleanToken(chunk);
    addCandidate(candidates, token, scoreToken(token, match[0], true));

    if (lenovoHint) {
      for (const variant of lenovoSerialVariants(chunk)) {
        addCandidate(candidates, variant.value, 170 + variant.bonus);
      }
    }
  }

  const compactText = normalized.replace(/\s+/g, ' ');
  const snInlinePattern = /(?:S\s*N|SN|S[AY]?N[EFY]?)\s*[:#-]?\s*([A-Z0-9]{6,20})/g;
  while ((match = snInlinePattern.exec(compactText))) {
    const token = cleanToken(match[1]);
    addCandidate(candidates, token, scoreToken(token, match[0], true));
    if (lenovoHint) {
      for (const variant of lenovoSerialVariants(match[1])) {
        addCandidate(candidates, variant.value, 175 + variant.bonus);
      }
    }
  }

  const adidPattern = /ADID\s*[:#-]?\s*([A-Z0-9]{12,24})/g;
  while ((match = adidPattern.exec(normalized))) {
    for (const variant of lenovoSerialVariants(match[1])) {
      addCandidate(candidates, variant.value, 158 + variant.bonus);
    }
  }

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(normalized))) {
    const rawToken = match[0];
    const token = cleanToken(rawToken);
    const start = Math.max(0, match.index - 32);
    const end = Math.min(normalized.length, match.index + rawToken.length + 32);
    const context = normalized.slice(start, end);
    addCandidate(candidates, token, scoreToken(token, context, false));
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, score]) => ({ value, score }));
}

export function extractBestSerial(rawText) {
  return extractSerialCandidates(rawText)[0]?.value || '';
}

export function sanitizeSerial(value) {
  return cleanToken(value);
}
