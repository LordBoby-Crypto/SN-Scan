const LABEL_PATTERN = /(?:^|[^A-Z0-9])(?:S\s*[\\/]?\s*N|SN|SERIAL(?:\s*(?:NO|NUMBER|#))?|SER\s*NO)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{4,24})/gi;
const TOKEN_PATTERN = /[A-Z0-9]{6,24}/g;
const KNOWN_MODEL_PREFIXES = ['MTM', 'MODEL', 'ADID', 'MO', 'MFG', 'DATE', 'INPUT', 'FACTORY'];

function cleanToken(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^(?:SN|SNO|SERIALNO|SERIALNUMBER)/, '')
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
  if (/S\s*[\\/]?\s*N|SERIAL/i.test(context)) score += 25;
  if (/MTM|MODEL|ADID|MFG|DATE|INPUT|FACTORY/i.test(context)) score -= 40;
  if (/82W2|KUS|20V|325A/.test(token)) score -= 35;
  return score;
}

export function extractSerialCandidates(rawText) {
  const normalized = String(rawText || '')
    .toUpperCase()
    .replace(/[|]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/\r/g, '\n');
  const candidates = new Map();

  let match;
  LABEL_PATTERN.lastIndex = 0;
  while ((match = LABEL_PATTERN.exec(normalized))) {
    const chunk = match[1].split(/\n|\s{2,}|\b(?:MTM|MODEL|ADID|MFG|DATE|INPUT|FACTORY)\b/)[0];
    const token = cleanToken(chunk);
    if (isPlausible(token)) {
      candidates.set(token, Math.max(candidates.get(token) || 0, scoreToken(token, match[0], true)));
    }
  }

  const compact = normalized.replace(/\s+/g, ' ');
  const snInlinePattern = /(?:S\s*N|SN)\s*[:#-]?\s*([A-Z0-9]{6,20})/g;
  while ((match = snInlinePattern.exec(compact))) {
    const token = cleanToken(match[1]);
    if (isPlausible(token)) {
      candidates.set(token, Math.max(candidates.get(token) || 0, scoreToken(token, match[0], true)));
    }
  }

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(normalized))) {
    const token = cleanToken(match[0]);
    if (!isPlausible(token)) continue;
    const start = Math.max(0, match.index - 28);
    const end = Math.min(normalized.length, match.index + token.length + 28);
    const context = normalized.slice(start, end);
    candidates.set(token, Math.max(candidates.get(token) || 0, scoreToken(token, context, false)));
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
