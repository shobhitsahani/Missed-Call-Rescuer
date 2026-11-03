/**
 * Validation and State Machine Helpers for Voice Agent
 * Handles:
 * - Customer unavailability detection
 * - Preferred callback time validation and extraction
 * - Spoken input sanitization
 */

export interface CallbackTimeResult {
  isValid: boolean;
  isFlexible: boolean;
  timeText: string | null;
  reason?: 'valid' | 'flexible' | 'unknown' | 'no_time_found' | 'arbitrary_number';
}

const UNAVAILABLE_PATTERNS = [
  /\b(?:busy|too\s+busy|busy\s+right\s+now|busy\s+at\s+the\s+moment)\b/i,
  /\b(?:can'?t\s+talk|cannot\s+talk|can'?t\s+speak|unable\s+to\s+talk|unable\s+to\s+speak)\b/i,
  /\b(?:not\s+a\s+good\s+time|bad\s+time|not\s+right\s+now|not\s+a\s+great\s+time)\b/i,
  /\b(?:in\s+a\s+meeting|at\s+work|driving|on\s+the\s+road|on\s+another\s+call|stepping\s+out|walking\s+into\s+a\s+meeting)\b/i,
  /\b(?:call\s+me\s+later|call\s+back\s+later|call\s+me\s+back|call\s+later|reach\s+out\s+later|call\s+another\s+time|try\s+again\s+later|can\s+you\s+call\s+back)\b/i,
  /\b(?:unavailable|not\s+available)\b/i,
  /\b(?:have\s+to\s+go|gotta\s+go|need\s+to\s+run|have\s+to\s+run|stepping\s+away)\b/i,
  // Multilingual unavailability indicators (es, fr, de, hi)
  /(?:ahora\s+no|no\s+puedo\s+hablar|estoy\s+ocupad[oa]|ll[aá]mame\s+m[aá]s\s+tarde)(?!\w)/i,
  /(?:pas\s+maintenant|ne\s+peux\s+pas\s+parler|je\s+suis\s+occup[eé]|rappelez\s+plus\s+tard)(?!\w)/i,
  /(?:nicht\s+jetzt|kann\s+nicht\s+sprechen|bin\s+besch[aä]ftigt|sp[aä]ter\s+anrufen)(?!\w)/i,
  /(?:abhi\s+nahi|baad\s+me(?:n)?\s+call\s+karo|busy\s+hoon)(?!\w)/i,
];

const GREETING_REJECTION_PATTERNS = [
  /^(?:no|nope|nah|not\s+really|not\s+at\s+all|no\s+it'?s\s+not|no\s+it\s+isn'?t|not\s+right\s+now)[.!]?$/i,
  /^no[,.\s]+(?:i'?m|it'?s|i\s+am)\b/i,
  // Multilingual greeting rejections
  /^(?:non|nein|nahi|n[aã]o)[.!]?$/i,
  /^(?:non|nein|nahi)[,.\s]+/i,
];

/**
 * Detects whether customer is communicating unavailability to talk.
 *
 * @param text The customer utterance text.
 * @param isGreetingTurn True if the agent just asked "Is now a good time to chat?"
 */
export function isCustomerUnavailable(text: string, isGreetingTurn = false): boolean {
  if (!text) return false;
  const clean = text.trim();
  if (!clean) return false;

  if (isGreetingTurn) {
    for (const pattern of GREETING_REJECTION_PATTERNS) {
      if (pattern.test(clean)) return true;
    }
  }

  for (const pattern of UNAVAILABLE_PATTERNS) {
    if (pattern.test(clean)) return true;
  }

  return false;
}

const SPECIFIC_TIME_PATTERNS = [
  // "tomorrow at 2 pm", "tomorrow morning", "tomorrow afternoon", "tomorrow"
  /\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week)(?:\s+(?:morning|afternoon|evening|night|at\s+(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:am|pm)?))?\b/i,
  // Standalone or prepositional clock time with colon (e.g. "at 4:30", "around 4:30 pm", "4:30")
  /\b(?:(?:at|around|about|after|before|by)\s+)?(?:1[0-2]|0?[1-9]):[0-5][0-9]\s*(?:am|pm)?\b/i,
  // Prepositional time with explicit am/pm/o'clock (e.g. "at 3 pm", "around 4 o'clock", "before 11 am")
  /\b(?:at|around|about|after|before|by)\s+(?:1[0-2]|0?[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:am|pm|o'?clock|\s+in\s+the\s+(?:morning|afternoon|evening))\b/i,
  // Time ranges: "between 2 and 4 pm", "between 9:00 and 11:30 am"
  /\bbetween\s+(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:am|pm)?\s*(?:and|to)\s*(?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:am|pm)?\b/i,
  // Standalone clock times with am/pm or o'clock (e.g. "2:30 pm", "4 pm", "10 am", "5 o'clock")
  /\b(?:1[0-2]|0?[1-9])\s*(?:am|pm|o'?clock)\b/i,
  // Relative time: "in an hour", "in about two hours", "in 2 hours", "in 30 minutes", "later today", "tonight", "this evening"
  /\b(?:in\s+(?:about\s+|around\s+)?(?:an?|\d+|half\s+an?|two|three|four|five|ten|twenty|thirty)\s+(?:hours?|minutes?|days?)|later\s+today|this\s+(?:morning|afternoon|evening|night)|tonight)\b/i,
  // Time-of-day phrases: "first thing in the morning", "noon", "midday", "after work"
  /\b(?:first\s+thing\s+in\s+the\s+morning|noon|midday|after\s+work|in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening)\b/i,
  // Preposition + single hour 1-12 without am/pm, strictly excluding address/quantity units (e.g. "at 3", "around four")
  /\b(?:at|around|about|after|before|by)\s+(?:1[0-2]|0?[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s+(?:st|street|ave|avenue|road|rd|blvd|lane|drive|dr|way|court|ct|floor|room|suite|apt|apartment|people|person|dollars|bucks|cents|percent|%|items|miles|km|pounds|lbs|kg|times|pieces|calls|tickets|customers))\b/i,
];

const FLEXIBLE_TIME_PATTERNS = [
  /\b(?:anytime|any\s+time|whenever|asap|as\s+soon\s+as\s+possible|doesn'?t\s+matter|no\s+preference|whenever\s+(?:you\s+can|possible|convenient)|any\s+time\s+is\s+fine|anytime\s+works)\b/i,
];

const UNKNOWN_OR_REFUSAL_PATTERNS = [
  /\b(?:don'?t\s+know|not\s+sure|no\s+idea|can'?t\s+say|never\s+mind|i\s+have\s+no\s+idea|i'?m\s+not\s+sure)\b/i,
];

/**
 * Validates and extracts a callback time preference from customer text.
 * Strictly avoids treating arbitrary numbers (e.g. "42", "123", "9876543210")
 * or non-time conversational words as valid times.
 */
export function validateCallbackTime(text: string): CallbackTimeResult {
  if (!text) return { isValid: false, isFlexible: false, timeText: null, reason: 'no_time_found' };
  const clean = text.trim();
  if (!clean) return { isValid: false, isFlexible: false, timeText: null, reason: 'no_time_found' };

  // Check flexible / anytime
  for (const pat of FLEXIBLE_TIME_PATTERNS) {
    if (pat.test(clean)) {
      return { isValid: true, isFlexible: true, timeText: 'flexible / anytime', reason: 'flexible' };
    }
  }

  // Check explicit unknown
  for (const pat of UNKNOWN_OR_REFUSAL_PATTERNS) {
    if (pat.test(clean)) {
      return { isValid: false, isFlexible: false, timeText: null, reason: 'unknown' };
    }
  }

  // Check for arbitrary isolated numbers without time context (e.g. "42", "9876543210")
  if (/^\s*\d+\s*$/.test(clean)) {
    return { isValid: false, isFlexible: false, timeText: null, reason: 'arbitrary_number' };
  }

  // Check specific time patterns
  for (const pat of SPECIFIC_TIME_PATTERNS) {
    const match = clean.match(pat);
    if (match) {
      // Capitalize first character of match
      const matchedText = match[0].trim();
      const formatted = matchedText.charAt(0).toUpperCase() + matchedText.slice(1);
      return { isValid: true, isFlexible: false, timeText: formatted, reason: 'valid' };
    }
  }

  return { isValid: false, isFlexible: false, timeText: null, reason: 'no_time_found' };
}

/**
 * Extracts callback time from customer utterance if present. Returns string or null.
 */
export function extractCallbackTime(text: string): string | null {
  const result = validateCallbackTime(text);
  return result.isValid ? result.timeText : null;
}

/**
 * Strips markdown markup from AI output before passing to Text-to-Speech synthesis
 * to prevent speech engines from vocalizing symbols ("asterisk asterisk", "hashtag", etc.).
 */
export function sanitizeTtsText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[CALL_COMPLETE\]/gi, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')   // Bold **text**
    .replace(/\*(.*?)\*/g, '$1')       // Italic *text*
    .replace(/#{1,6}\s+/g, '')         // Headings # ## ###
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // Inline code / code blocks
    .replace(/^\s*[-*+]\s+/gm, '')     // Markdown bullet lists
    .replace(/\s+/g, ' ')
    .trim();
}
