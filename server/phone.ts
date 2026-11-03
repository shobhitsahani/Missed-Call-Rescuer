/**
 * Phone Number Validation, Spoken-Digit Parsing, and Contact Policy Guard
 * 
 * Handles:
 * - Spoken digits, word multipliers, and text representations from STT.
 * - Format validation (NANP, Indian mobile, international E.164).
 * - Phone extraction from conversational utterances.
 * - Customer refusal detection.
 * - Safe masking for privacy.
 */

export type PhoneStatus =
  | 'verified'    // Caller ID verified by provider / carrier metadata
  | 'unknown'     // No verified caller ID available
  | 'collected'   // Number provided but pending validation / incomplete
  | 'validated'   // Number validated and normalized
  | 'confirmed'   // Customer confirmed the on-file or spoken number
  | 'declined';   // Customer explicitly refused to provide phone number

export interface ParsedPhone {
  isValid: boolean;
  digits: string;
  normalized?: string;
  formatted?: string;
  reason?: 'incomplete' | 'too_long' | 'invalid_pattern' | 'no_digits';
}

export type PhoneCountry = 'US' | 'IN';

const WORD_TO_DIGIT: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const REFUSAL_PATTERNS = [
  /(?:don'?t|do\s+not)\s+want\s+(?:to\s+)?(?:give|share|provide|leave)/i,
  /rather\s+not\s+(?:give|share|provide|say|leave)/i,
  /(?:won'?t|will\s+not)\s+(?:give|share|provide|say|leave)/i,
  /no\s+(?:phone|number|callback|calls?)/i,
  /(?:don'?t|do\s+not)\s+have\s+(?:a\s+)?(?:phone|number|callback)/i,
  /not\s+giving\s+(?:you\s+)?(?:my\s+)?(?:phone\s+)?number/i,
  /refuse\s+to\s+(?:give|share|provide)/i,
  /private\s+number/i,
  /prefer\s+not\s+to\s+(?:say|share|give|leave)/i,
];

/**
 * Detects if the customer explicitly declines to provide their phone number.
 */
export function isPhoneRefusal(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/**
 * Converts spoken number phrases ("five five five oh one two three") into digits.
 * Handles "double X" and "triple X", punctuation, and mixed word/digit strings.
 */
export function wordsToDigits(text: string): string {
  if (!text) return '';
  const cleaned = text.toLowerCase().replace(/[\(\)\[\]{},.+\-_/\\:;!?"']/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let result = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if ((token === 'double' || token === 'twice') && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const digit = WORD_TO_DIGIT[next] || (next.length === 1 && /\d/.test(next) ? next : null);
      if (digit) {
        result += digit + digit;
        i++;
        continue;
      }
    }

    if (token === 'triple' && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const digit = WORD_TO_DIGIT[next] || (next.length === 1 && /\d/.test(next) ? next : null);
      if (digit) {
        result += digit + digit + digit;
        i++;
        continue;
      }
    }

    if (WORD_TO_DIGIT[token] !== undefined) {
      result += WORD_TO_DIGIT[token];
    } else if (/^\d+$/.test(token)) {
      result += token;
    }
  }

  return result;
}

/**
 * Normalizes any phone input (spoken words, formatted numbers, mixed) into raw digits.
 */
export function normalizePhoneDigits(raw: string): string {
  if (!raw) return '';
  const converted = wordsToDigits(raw);
  if (converted) return converted;
  return raw.replace(/\D/g, '');
}

/**
 * Validates a string of digits and formats into standard E.164 and display representation.
 */
export function validatePhoneDigits(rawDigits: string, defaultCountry: PhoneCountry = 'US'): ParsedPhone {
  const digits = rawDigits.replace(/\D/g, '');

  if (!digits || digits.length === 0) {
    return { isValid: false, digits: '', reason: 'no_digits' };
  }

  // Check for invalid repetitive patterns (e.g. "0000000000" or "1111111111")
  if (/^(\d)\1{6,}$/.test(digits)) {
    return { isValid: false, digits, reason: 'invalid_pattern' };
  }

  // 10 digits: Indian mobile (when the business locale is India) or US/NANP.
  if (digits.length === 10) {
    const firstDigit = digits[0];
    // Indian 10-digit mobile starts with 6, 7, 8, or 9
    if (defaultCountry === 'IN' && firstDigit >= '6' && firstDigit <= '9') {
      return {
        isValid: true,
        digits,
        normalized: `+91${digits}`,
        formatted: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
      };
    }
    // US Area code cannot start with 0 or 1
    if (firstDigit >= '2' && firstDigit <= '9') {
      const area = digits.slice(0, 3);
      const prefix = digits.slice(3, 6);
      const line = digits.slice(6, 10);
      return {
        isValid: true,
        digits,
        normalized: `+1${digits}`,
        formatted: `+1 (${area}) ${prefix}-${line}`,
      };
    }
    return { isValid: false, digits, reason: 'invalid_pattern' };
  }

  // 11 digits starting with 1: US with country code
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    if (area[0] >= '2' && area[0] <= '9') {
      return {
        isValid: true,
        digits,
        normalized: `+${digits}`,
        formatted: `+1 (${area}) ${prefix}-${line}`,
      };
    }
    return { isValid: false, digits, reason: 'invalid_pattern' };
  }

  // 12 digits starting with 91: India with country code
  if (digits.length === 12 && digits.startsWith('91')) {
    const mobile = digits.slice(2);
    if (mobile[0] >= '6' && mobile[0] <= '9') {
      return {
        isValid: true,
        digits,
        normalized: `+${digits}`,
        formatted: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`,
      };
    }
    return { isValid: false, digits, reason: 'invalid_pattern' };
  }

  // General E.164 (11 to 15 digits)
  if (digits.length >= 11 && digits.length <= 15) {
    return {
      isValid: true,
      digits,
      normalized: `+${digits}`,
      formatted: `+${digits}`,
    };
  }

  if (digits.length < 10) {
    return { isValid: false, digits, reason: 'incomplete' };
  }

  return { isValid: false, digits, reason: 'too_long' };
}

function isLikelyPhoneAttempt(text: string, digits: string, hasPending: boolean): boolean {
  if (!digits || digits.length === 0) return false;

  // Standalone complete phone numbers (7+ digits)
  if (digits.length >= 7) return true;

  const cleaned = text.toLowerCase().replace(/[\(\)\[\]{},.+\-_/\\:;!?"']/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const ALLOWED_PHONE_WORDS = new Set([
    'double', 'twice', 'triple',
    'my', 'number', 'is', 'it', "it's", 'its',
    'call', 'at', 'phone', 'cell', 'mobile',
    'and', 'the', 'last', 'digit', 'digits',
    'area', 'code', 'plus', 'one', 'callback',
    'here', 'giving',
  ]);

  // Count tokens that are NOT digits, digit words, or recognized phone preamble
  const nonPhoneTokens = tokens.filter(t =>
    WORD_TO_DIGIT[t] === undefined &&
    !/^\d+$/.test(t) &&
    !ALLOWED_PHONE_WORDS.has(t)
  );

  // If there are substantive conversational words (more than 1 non-phone token),
  // reject as conversational speech (e.g. "two leaks in my basement", "one question about sink").
  if (nonPhoneTokens.length > 1) {
    return false;
  }

  // If continuing pending digits with a short fragment (1 to 6 digits)
  if (hasPending && digits.length >= 1) {
    return true;
  }

  // If starting a new phone sequence without pending digits (e.g. "987", "nine eight seven")
  if (digits.length >= 3) {
    return true;
  }

  // If fewer than 3 digits without pending digits:
  // Only accept if explicit phone keywords are present (e.g. "my number is 5", "cell 2")
  const hasPhoneKeyword = tokens.some(t => ['phone', 'number', 'cell', 'mobile', 'callback'].includes(t));
  if (hasPhoneKeyword && digits.length >= 1) {
    return true;
  }

  return false;
}

/**
 * Extracts potential phone number from customer speech or text.
 * Checks formatted digit sequences, spoken phrases, and multi-turn digit stitching.
 */
export function extractPhoneFromUtterance(
  text: string,
  defaultCountry: PhoneCountry = 'US',
  pendingDigits?: string | null
): ParsedPhone | null {
  if (!text) return null;

  // 1. First look for formatted or clustered digit sequences
  const digitClusterRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const clusterMatches = text.match(digitClusterRegex);
  if (clusterMatches && clusterMatches.length > 0) {
    const candidate = clusterMatches[clusterMatches.length - 1];
    const parsed = validatePhoneDigits(candidate, defaultCountry);
    if (parsed.isValid) return parsed;
  }

  // 2. Normalize spoken words and numbers into digits
  const spokenDigits = normalizePhoneDigits(text);
  if (!spokenDigits) return null;

  const hasPending = Boolean(pendingDigits && pendingDigits.length > 0);
  if (!isLikelyPhoneAttempt(text, spokenDigits, hasPending)) {
    return null;
  }

  // 2a. Check standalone validation
  const standaloneParsed = validatePhoneDigits(spokenDigits, defaultCountry);
  if (standaloneParsed.isValid) {
    return standaloneParsed;
  }

  // 2b. If we have pending digits from previous turn(s), try combining
  if (hasPending) {
    const combined = pendingDigits! + spokenDigits;
    const combinedParsed = validatePhoneDigits(combined, defaultCountry);
    if (combinedParsed.isValid) {
      return combinedParsed;
    }
    if (combined.length < 10) {
      return { isValid: false, digits: combined, reason: 'incomplete' };
    }
  }

  // 2c. If spokenDigits alone is incomplete
  if (spokenDigits.length < 10) {
    return { isValid: false, digits: spokenDigits, reason: 'incomplete' };
  }

  return standaloneParsed;
}

/**
 * Mask middle digits of phone number for privacy (keeps last 4 digits visible).
 */
export function maskPhone(phone?: string | null): string {
  if (!phone || phone === 'unknown') return 'unknown';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 4) return trimmed;

  const last4 = digits.slice(-4);
  if (trimmed.startsWith('+')) {
    const ccLen = Math.max(1, digits.length - 10);
    const cc = digits.slice(0, ccLen);
    return `+${cc} ******${last4}`;
  }
  const prefix = digits.length > 7 ? digits.slice(0, digits.length - 7) : digits.slice(0, 2);
  return `${prefix} ******${last4}`;
}
