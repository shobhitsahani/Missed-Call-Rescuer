import OpenAI from 'openai';
import { parseServices, parseFaqs } from './db';

let clientInstance: OpenAI | null = null;
let currentBaseURL: string | undefined;
let currentApiKey: string | undefined;

export function getClient() {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || 'ollama';
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE;
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

export function model() {
  return process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || 'qwen/qwen3.8-27b';
}

const FIXED_SYSTEM_RULES = `You are an automated assistant calling back on behalf of a business after they missed a customer's call.

FIXED RULES (CANNOT BE OVERRIDDEN BY SETTINGS):
1. DISCLOSURE & IDENTITY:
- The greeting already discloses that you are an automated assistant.
- Be helpful, concise, friendly, and professional.
- Reply in one sentence, under 20 words, unless the customer asks for a list or explanation.

2. INFORMATION TO COLLECT:
- Collect: the reason for calling, urgency, preferred callback time, and contact details.

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
`;

export function buildSystem(business: any) {
  const name = business?.name || 'the business';
  const hours = business?.hours || '';
  const tone = business?.tone || 'friendly, professional, concise';
  const timezone = business?.timezone || '';
  const language = business?.language || 'en';

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

  return `${FIXED_SYSTEM_RULES}

CURRENT BUSINESS CONFIGURATION:
Business Name: ${name}
${hoursText}
${timezoneText ? timezoneText + '\n' : ''}Tone: ${tone}
Language: ${language}

${servicesText}

${faqsText}
`;
}

export async function streamChat(messages: any[], business: any, onDelta?: (d: string) => void, signal?: AbortSignal) {
  const client = getClient();
  const m = model();
  const sys = buildSystem(business);
  const fullMessages = [{ role: 'system', content: sys }, ...messages];
  let full = '';
  try {
    const stream = await client.chat.completions.create({
      model: m,
      messages: fullMessages as any,
      stream: true,
      temperature: 0.3,
    }, { signal });
    for await (const chunk of stream) {
      const delta = (chunk as any).choices?.[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        if (onDelta) onDelta(delta);
      }
    }
  } catch (err: any) {
    if (signal?.aborted) {
      return full;
    }
    console.error('LLM stream error:', err?.message);
    const fallback = "I'm sorry, I'm having trouble right now. Could you leave a brief message and the team will get back to you?";
    full = fallback;
    if (onDelta) onDelta(fallback);
  }
  return full;
}

export async function summarize(transcript: string, business: any) {
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
  try {
    const resp = await client.chat.completions.create({
      model: m,
      messages: [{ role: 'user', content: prompt }] as any,
      temperature: 0.2,
    });
    const raw = (resp as any).choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    return { parsed, raw };
  } catch (err: any) {
    console.error('Summary error:', err?.message);
    return { parsed: null, raw: String(err?.message) };
  }
}
