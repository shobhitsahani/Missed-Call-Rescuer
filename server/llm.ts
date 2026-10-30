import OpenAI from 'openai';

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

const SYSTEM_PROMPT = `You are an automated assistant calling back on behalf of a business after they missed a customer's call.
You must:
- Disclose at the start that you are an automated assistant (the greeting handles this).
- Be helpful, concise, friendly, professional.
- Collect: reason for calling, urgency, preferred callback time, contact details.
- Never invent facts, prices, or booking confirmations. If asked about pricing/availability, say the owner will confirm.
- Honor opt-out: if customer says stop calling / do not call / remove me, acknowledge and end.
- Reply in one sentence, under 20 words, unless the customer asks for detail.
- Answer only from business config provided.
`;

export function buildSystem(business: any) {
  return `${SYSTEM_PROMPT}
Business: ${business.name}
Hours: ${business.hours}
Services: ${business.services}
FAQs: ${business.faqs}
Tone: ${business.tone}
Language: ${business.language}`;
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
      temperature: 0.4,
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
    const fallback = "I'm sorry, I'm having trouble right now. Could you leave a brief message and the owner will get back to you?";
    full = fallback;
    if (onDelta) onDelta(fallback);
  }
  return full;
}

export async function summarize(transcript: string, business: any) {
  const client = getClient();
  const m = model();
  const prompt = `You are extracting a structured summary from a phone callback conversation. Return ONLY valid JSON with these fields:
{
  "reason": string,
  "urgency": "low"|"medium"|"high",
  "preferred_time": string,
  "contact_details": string,
  "suggested_action": string,
  "short_summary": string,
  "sentiment": "positive"|"neutral"|"negative"
}
Do not invent facts. If unknown use "not specified"/"not provided".

Business: ${business.name}
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
