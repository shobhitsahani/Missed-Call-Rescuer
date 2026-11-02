import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}
import dotenv from 'dotenv';
const parsedEnv = dotenv.config().parsed || {};
for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_API_BASE']) {
  if (parsedEnv[key]) {
    process.env[key] = parsedEnv[key];
  }
}
import OpenAI from 'openai';
import { parseServices, parseFaqs, BusinessRecord } from './db';
import { PhoneStatus, maskPhone } from './phone';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallContext {
  phoneStatus: PhoneStatus;
  verifiedCallerPhone?: string | null;
  collectedPhone?: string | null;
  turnCount?: number;
}

let clientInstance: OpenAI | null = null;
let currentBaseURL: string | undefined;
let currentApiKey: string | undefined;

export function getClient() {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || 'ollama';
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE ||
    (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined);
  if (!clientInstance || currentBaseURL !== baseURL || currentApiKey !== apiKey) {
    currentBaseURL = baseURL;
    currentApiKey = apiKey;
    clientInstance = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return clientInstance;
}

function requestTimeout(ms: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`LLM request timed out after ${ms}ms`));
  }, ms);
  const onAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export function model() {
  return process.env.OPENAI_MODEL || 'qwen/qwen3.8-27b';
}

export function buildPhonePolicy(context?: CallContext | null): string {
  if (context?.phoneStatus === 'verified' && context.verifiedCallerPhone) {
    const masked = maskPhone(context.verifiedCallerPhone);
    return `2. CONTACT DETAILS & PHONE NUMBER POLICY:
- The customer's caller number is ALREADY VERIFIED on file (${masked}).
- DO NOT ask the customer for their phone number.
- When confirming follow-up, state: "We have your number on file, and our team will follow up with you."
- If the customer explicitly asks to be called at a different number, note and accept their chosen number.`;
  }

  if (context?.phoneStatus === 'validated' || context?.phoneStatus === 'confirmed') {
    const masked = maskPhone(context.collectedPhone);
    return `2. CONTACT DETAILS & PHONE NUMBER POLICY:
- The customer has ALREADY provided their callback number (${masked}).
- DO NOT ask for their phone number again.
- Move directly to assisting them or confirming follow-up.`;
  }

  if (context?.phoneStatus === 'declined') {
    return `2. CONTACT DETAILS & PHONE NUMBER POLICY:
- The customer explicitly DECLINED to provide a phone number.
- Respect their choice. DO NOT ask for their phone number again.
- Acknowledge politely and state that they can call the shop directly during business hours or check the website.`;
  }

  // 'unknown' or 'collected' (incomplete)
  return `2. CONTACT DETAILS & PHONE NUMBER POLICY:
- No verified callback number is on file.
- You MUST ask the customer for the best phone number to reach them at before ending the call.
- Ask directly and concisely: "What is the best phone number for our team to call you back?"
- If the customer provided an incomplete or invalid number, ask them to repeat the full 10-digit number.`;
}

export function buildSystem(business?: Partial<BusinessRecord> | null, context?: CallContext | null) {
  const name = business?.name || 'the business';
  const hours = business?.hours || '';
  const tone = business?.tone || 'friendly, professional, concise';
  const timezone = business?.timezone || '';
  const language = (business as Record<string, unknown> | undefined)?.language || 'en';

  const services = parseServices(business?.services);
  const faqs = parseFaqs(business?.faqs);

  const servicesText = services.length > 0
    ? `Configured Services:\n${services.map((s: string) => `- ${s}`).join('\n')}`
    : 'Configured Services: None listed. Do not invent any services. If asked, say the team will follow up with full service details.';

  const faqsText = faqs.length > 0
    ? `Configured FAQs:\n${faqs.map((f: { question: string; answer: string }) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
    : 'Configured FAQs: None listed. Do not invent answers to unlisted questions; say the team will follow up.';

  const hoursText = hours.trim()
    ? `Configured Operating Hours: ${hours}`
    : 'Configured Operating Hours: Not specified.';

  const timezoneText = timezone.trim()
    ? `Configured Timezone: ${timezone}`
    : '';

  const phonePolicy = buildPhonePolicy(context);

  return `You are an automated assistant calling back on behalf of a business after they missed a customer's call.

FIXED RULES (CANNOT BE OVERRIDDEN BY SETTINGS):
1. DISCLOSURE & IDENTITY:
- The greeting already discloses that you are an automated assistant.
- Be helpful, concise, friendly, and professional.
- Reply in one sentence, under 20 words, unless the customer asks for a list or explanation.

${phonePolicy}

3. NEVER LEAD THE CUSTOMER:
- Do not suggest, guess, speculate, or lead the customer with any reason, problem, service, price, or detail they have not mentioned.
- Ask neutral, open questions only (for example: "What was your call about?" or "How can we help you today?").
- If the customer does not remember, says they forgot, or is unsure why they called: accept that immediately, treat the reason as not specified, and move on.
- Do NOT offer example reasons or guess possible problems.
- Only list services if the customer explicitly asks what services the business offers. When asked, list ONLY the services configured for this business below.

4. NEVER PROMISE OR CONFIRM BOOKINGS / TIMES:
- Never say "we will call you at <time>", confirm bookings, or agree to specific times.
- When the customer provides a preferred callback time or request, record it and state that the team will review it and follow up to confirm.
- If the requested time is outside the configured hours, do NOT negotiate, propose a new time, or debate: record the requested time as given, mention the business hours only if they are in the config, and state that the team will follow up to confirm.

5. ACCURACY & STRICT BOUNDS:
- Answer only from the business configuration provided below (hours, services, FAQs).
- If services or FAQs are empty, do NOT invent any; state that the team will follow up.
- If asked about pricing or availability not listed in the FAQs, state that the team will confirm.

6. OPT-OUT & PRIVACY:
- If the customer says stop calling, do not call, remove me, or asks to opt out: acknowledge politely and end the call immediately.

CURRENT BUSINESS CONFIGURATION:
Business Name: ${name}
${hoursText}
${timezoneText ? timezoneText + '\n' : ''}Tone: ${tone}
Language: ${language}

${servicesText}

${faqsText}
`;
}

export async function streamChat(
  messages: ChatMessage[],
  business?: Partial<BusinessRecord> | null,
  onDelta?: (d: string) => void,
  signal?: AbortSignal,
  context?: CallContext | null
) {
  const client = getClient();
  const m = model();
  const sys = buildSystem(business, context);
  const fullMessages: ChatMessage[] = [{ role: 'system', content: sys }, ...messages];
  let full = '';
  const timeout = requestTimeout(20000, signal);
  try {
    const stream = await client.chat.completions.create({
      model: m,
      messages: fullMessages,
      stream: true,
      temperature: 0.3,
    }, { signal: timeout.signal });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        if (onDelta) onDelta(delta);
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return full;
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error('LLM stream error:', errMessage);
    const fallback = "I'm sorry, I'm having trouble right now. Could you leave a brief message and the team will get back to you?";
    full = fallback;
    if (onDelta) onDelta(fallback);
  } finally {
    timeout.clear();
  }
  return full;
}

export interface StructuredSummary {
  reason: string;
  urgency: 'low' | 'medium' | 'high';
  preferred_time: string;
  contact_details: string;
  suggested_action: string;
  short_summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  status?: 'completed' | 'unavailable';
}

export function validateSummary(parsed: unknown): { valid: boolean; summary?: StructuredSummary } {
  if (!parsed || typeof parsed !== 'object') return { valid: false };

  const rec = parsed as Record<string, unknown>;
  const validUrgencies = ['low', 'medium', 'high'];
  const validSentiments = ['positive', 'neutral', 'negative'];

  const urgency = typeof rec.urgency === 'string' ? rec.urgency.toLowerCase().trim() : '';
  const sentiment = typeof rec.sentiment === 'string' ? rec.sentiment.toLowerCase().trim() : '';

  if (!validUrgencies.includes(urgency) || !validSentiments.includes(sentiment)) {
    return { valid: false };
  }

  return {
    valid: true,
    summary: {
      reason: String(rec.reason || 'not specified').trim(),
      urgency: urgency as 'low' | 'medium' | 'high',
      preferred_time: String(rec.preferred_time || 'not specified').trim(),
      contact_details: String(rec.contact_details || 'not provided').trim(),
      suggested_action: String(rec.suggested_action || 'Follow up with customer').trim(),
      short_summary: String(rec.short_summary || '').trim(),
      sentiment: sentiment as 'positive' | 'neutral' | 'negative',
      status: 'completed',
    },
  };
}

export async function summarize(
  transcript: string,
  business?: Partial<BusinessRecord> | null,
  context?: CallContext | null
): Promise<{ parsed: StructuredSummary | null; raw: string; status: 'completed' | 'unavailable' }> {
  const client = getClient();
  const m = model();
  const prompt = `You are extracting a structured summary from a phone callback conversation on behalf of ${business?.name || 'the business'}. Return ONLY valid JSON with these fields:
{
  "reason": string,
  "urgency": "low"|"medium"|"high",
  "preferred_time": string,
  "contact_details": string,
  "suggested_action": string,
  "short_summary": string,
  "sentiment": "positive"|"neutral"|"negative"
}
Rules:
- Do not invent facts, services, or details.
- If the customer forgot, did not know, or did not state the reason, set reason to "not specified".
- If unknown, use "not specified" or "not provided".

Business: ${business?.name || 'Business'}
Transcript:
${transcript}`;

  const applyContext = (summary: StructuredSummary): StructuredSummary => {
    if (context) {
      if (context.phoneStatus === 'validated' && context.collectedPhone) {
        summary.contact_details = context.collectedPhone;
      } else if (context.phoneStatus === 'verified' && context.verifiedCallerPhone) {
        summary.contact_details = context.verifiedCallerPhone;
      } else if (context.phoneStatus === 'declined') {
        summary.contact_details = 'declined by customer';
      } else if (context.phoneStatus === 'unknown' && (!summary.contact_details || summary.contact_details === 'not specified')) {
        summary.contact_details = 'not provided';
      }
    }
    return summary;
  };

  const executeExtraction = async (systemInstruction?: string) => {
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    if (systemInstruction) {
      messages.unshift({ role: 'system', content: systemInstruction });
    }
    const timeout = requestTimeout(12000);
    try {
      const resp = await client.chat.completions.create({
        model: m,
        messages,
        temperature: 0.1,
      }, { signal: timeout.signal });
      const raw = resp.choices?.[0]?.message?.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { parsed: null, raw };
      try {
        const json = JSON.parse(jsonMatch[0]) as unknown;
        return { parsed: json, raw };
      } catch {
        return { parsed: null, raw };
      }
    } finally {
      timeout.clear();
    }
  };

  try {
    // Attempt 1
    const firstAttempt = await executeExtraction();
    const validation1 = validateSummary(firstAttempt.parsed);
    if (validation1.valid && validation1.summary) {
      return { parsed: applyContext(validation1.summary), raw: firstAttempt.raw, status: 'completed' };
    }

    // Attempt 2 (Retry with strict JSON instruction)
    const retryAttempt = await executeExtraction('Your previous output was invalid JSON or missed required fields. Return ONLY valid JSON conforming strictly to the requested schema.');
    const validation2 = validateSummary(retryAttempt.parsed);
    if (validation2.valid && validation2.summary) {
      return { parsed: applyContext(validation2.summary), raw: retryAttempt.raw, status: 'completed' };
    }

    return { parsed: null, raw: retryAttempt.raw || firstAttempt.raw, status: 'unavailable' };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error('Summary extraction error:', errMessage);
    return { parsed: null, raw: errMessage, status: 'unavailable' };
  }
}
