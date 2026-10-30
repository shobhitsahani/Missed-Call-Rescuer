import dotenv from 'dotenv';
dotenv.config({ override: true });
import OpenAI from 'openai';

async function main() {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || 'ollama';
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE;
  const model = process.argv[2] || process.env.OPENAI_MODEL || 'llama-3.1-8b-instant';

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  const prompt = 'Hi, what are your hours today?';
  const runs = 5;
  const latencies: number[] = [];

  console.log(`Testing TTFT (Time To First Token) for model: ${model}`);
  console.log(`Base URL: ${baseURL || 'https://api.openai.com/v1'}`);
  console.log(`Prompt: "${prompt}"`);
  console.log('--------------------------------------------------');

  for (let i = 1; i <= runs; i++) {
    const start = Date.now();
    let ttft: number | null = null;
    let full = '';

    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        temperature: 0.4,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta && ttft === null) {
          ttft = Date.now() - start;
        }
        full += delta;
      }

      if (ttft !== null) {
        latencies.push(ttft);
        console.log(`Run ${i}: ${ttft} ms  (total: ${Date.now() - start} ms, "${full.slice(0, 30).trim()}...")`);
      } else {
        console.log(`Run ${i}: No tokens received`);
      }
    } catch (err: any) {
      console.error(`Run ${i} error:`, err?.message);
    }
  }

  console.log('--------------------------------------------------');
  if (latencies.length > 0) {
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    console.log(`Results for ${model}:`);
    console.log(`Average TTFT: ${avg} ms (min: ${min} ms, max: ${max} ms across ${latencies.length} runs)`);
  } else {
    console.log('No successful runs.');
  }
}

main().catch(console.error);
