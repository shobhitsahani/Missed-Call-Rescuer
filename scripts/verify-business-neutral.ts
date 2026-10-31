import dotenv from 'dotenv';
dotenv.config({ override: true });
import assert from 'assert';
import { streamChat } from '../server/llm';
import { BUSINESS_PRESETS, BusinessPreset } from '../src/lib/presets';

const PLUMBING_WORDS = [
  'pipe',
  'pipes',
  'leak',
  'leaks',
  'leaking',
  'plumb',
  'plumber',
  'plumbers',
  'plumbing',
  'drain',
  'drains',
  'drainage',
  'blockage',
  'water heater',
  'faucet',
  'toilet',
  'sewer',
];

const FORBIDDEN_PROMISES = [
  'we will call you at',
  'well call you at',
  "we'll call you at",
  'we will call at',
  "we'll call at",
  'i will call you at',
  "i'll call you at",
  'appointment is confirmed',
  'is confirmed for',
  'booked you for',
  'booked for',
  'scheduled you for',
  'guarantee a call at',
  'our team will be there at',
];

const LEADING_PATTERNS = [
  /was it (about|regarding|for)/i,
  /did you call (about|regarding|for)/i,
  /is it (about|regarding|for|related to)/i,
  /perhaps (it was|it's|you needed)/i,
  /maybe (it was|you needed|about)/i,
  /do you recall if it was/i,
  /are you looking for/i,
];

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface TestConfig {
  key: string;
  preset: BusinessPreset;
  industry: 'plumbing' | 'software' | 'dental';
  reasonUtterance: string;
}

const TEST_CONFIGS: TestConfig[] = [
  {
    key: 'plumbing',
    preset: BUSINESS_PRESETS.acme,
    industry: 'plumbing',
    reasonUtterance: 'Yes, I called because our kitchen drain is backed up.',
  },
  {
    key: 'team flow',
    preset: BUSINESS_PRESETS.teamFlow,
    industry: 'software',
    reasonUtterance: 'Yes, I called because our web application needs an SEO optimization and software consulting.',
  },
  {
    key: 'dental clinic',
    preset: BUSINESS_PRESETS.dentalClinic,
    industry: 'dental',
    reasonUtterance: 'Yes, I called because I need a routine dental exam and cleaning.',
  },
];

async function runTextTurn(messages: ConversationTurn[], business: any): Promise<string> {
  const reply = await streamChat(messages, business);
  return reply.trim();
}

async function verifyBusiness(config: TestConfig) {
  const { preset, industry, reasonUtterance } = config;
  console.log(`\n======================================================================`);
  console.log(`TESTING CONFIG: "${preset.name}" (${preset.label})`);
  console.log(`Industry: ${industry} | Hours: ${preset.hours}`);
  console.log(`Services: ${preset.services.join(', ')}`);
  console.log(`======================================================================\n`);

  // -------------------------------------------------------------------------
  // CONVERSATION A: Remembers reason -> Asks price -> Asks time outside hours
  // -------------------------------------------------------------------------
  console.log(`--- Scenario A: Remembers reason + Asks price + Asks off-hours callback ---`);
  const greeting = `Hi, this is an automated assistant calling on behalf of ${preset.name}. We noticed we missed your call earlier. Is now a good time to chat?`;
  console.log(`Agent: ${greeting}`);

  const historyA: ConversationTurn[] = [{ role: 'assistant', content: greeting }];

  // Turn 1: Customer remembers the reason
  console.log(`Customer: ${reasonUtterance}`);
  historyA.push({ role: 'user', content: reasonUtterance });
  const agentReply1 = await runTextTurn(historyA, preset);
  console.log(`Agent: ${agentReply1}`);
  historyA.push({ role: 'assistant', content: agentReply1 });

  // Turn 2: Customer asks about price
  const priceUtterance = 'How much do you charge for your services?';
  console.log(`Customer: ${priceUtterance}`);
  historyA.push({ role: 'user', content: priceUtterance });
  const agentReply2 = await runTextTurn(historyA, preset);
  console.log(`Agent: ${agentReply2}`);
  historyA.push({ role: 'assistant', content: agentReply2 });

  // Turn 3: Customer asks for a time outside business hours
  const offHoursUtterance = 'Can you call me back this Sunday night at 11:30 PM?';
  console.log(`Customer: ${offHoursUtterance}`);
  historyA.push({ role: 'user', content: offHoursUtterance });
  const agentReply3 = await runTextTurn(historyA, preset);
  console.log(`Agent: ${agentReply3}`);
  historyA.push({ role: 'assistant', content: agentReply3 });

  // -------------------------------------------------------------------------
  // CONVERSATION B: Customer says "I forgot" -> Customer asks what services offer
  // -------------------------------------------------------------------------
  console.log(`\n--- Scenario B: Customer says "I forgot" + Customer asks for services ---`);
  console.log(`Agent: ${greeting}`);
  const historyB: ConversationTurn[] = [{ role: 'assistant', content: greeting }];

  // Turn 1: Customer forgot reason
  const forgotUtterance = "Honestly, I completely forgot why I called earlier.";
  console.log(`Customer: ${forgotUtterance}`);
  historyB.push({ role: 'user', content: forgotUtterance });
  const agentReplyB1 = await runTextTurn(historyB, preset);
  console.log(`Agent: ${agentReplyB1}`);
  historyB.push({ role: 'assistant', content: agentReplyB1 });

  // Turn 2: Customer asks what services are offered
  const askServicesUtterance = 'Can you tell me what services you offer?';
  console.log(`Customer: ${askServicesUtterance}`);
  historyB.push({ role: 'user', content: askServicesUtterance });
  const agentReplyB2 = await runTextTurn(historyB, preset);
  console.log(`Agent: ${agentReplyB2}`);
  historyB.push({ role: 'assistant', content: agentReplyB2 });

  // -------------------------------------------------------------------------
  // ASSERTIONS
  // -------------------------------------------------------------------------
  const allAgentReplies = [agentReply1, agentReply2, agentReply3, agentReplyB1, agentReplyB2];

  // 1. Non-plumbing businesses must NOT contain plumbing words
  if (industry !== 'plumbing') {
    for (const reply of allAgentReplies) {
      const lower = reply.toLowerCase();
      for (const word of PLUMBING_WORDS) {
        assert(
          !lower.includes(word),
          `[FAIL: Industry word leakage] Found plumbing keyword "${word}" in ${industry} output:\n"${reply}"`
        );
      }
    }
    console.log(`✓ Assertion passed: No plumbing words found in "${preset.name}" conversation.`);
  }

  // 2. The agent must NEVER suggest or guess a reason when customer says "I forgot"
  for (const pattern of LEADING_PATTERNS) {
    assert(
      !pattern.test(agentReplyB1),
      `[FAIL: Agent led the customer] Agent suggested a reason when customer forgot:\n"${agentReplyB1}"`
    );
  }
  // Verify agent doesn't guess any unprompted services in replyB1
  for (const service of preset.services) {
    assert(
      !agentReplyB1.toLowerCase().includes(service.toLowerCase()),
      `[FAIL: Agent guessed service "${service}" before asked]:\n"${agentReplyB1}"`
    );
  }
  console.log(`✓ Assertion passed: Agent did not lead customer or guess reasons when customer forgot.`);

  // 3. The agent must NEVER promise or confirm a callback at a specific time
  for (const reply of [agentReply3]) {
    const lower = reply.toLowerCase();
    for (const phrase of FORBIDDEN_PROMISES) {
      assert(
        !lower.includes(phrase),
        `[FAIL: Agent promised/confirmed time] Found promise phrase "${phrase}" in reply:\n"${reply}"`
      );
    }
  }
  console.log(`✓ Assertion passed: Agent never promised or confirmed a specific callback time.`);

  // 4. The agent mentions ONLY services from the config
  const lowerServicesReply = agentReplyB2.toLowerCase();
  // Check that other industries' services are NOT mentioned
  const foreignServices = (industry === 'plumbing'
    ? [...BUSINESS_PRESETS.teamFlow.services, ...BUSINESS_PRESETS.dentalClinic.services]
    : industry === 'software'
    ? [...BUSINESS_PRESETS.acme.services, ...BUSINESS_PRESETS.dentalClinic.services]
    : [...BUSINESS_PRESETS.acme.services, ...BUSINESS_PRESETS.teamFlow.services]
  );
  for (const foreign of foreignServices) {
    assert(
      !lowerServicesReply.includes(foreign.toLowerCase()),
      `[FAIL: Foreign service mentioned] Agent mentioned unconfigured service "${foreign}" for ${preset.name}:\n"${agentReplyB2}"`
    );
  }
  console.log(`✓ Assertion passed: Agent mentioned only services from configured business profile.`);
}

async function main() {
  console.log('Running text pipeline verification across 3 distinct business profiles...\n');
  for (const config of TEST_CONFIGS) {
    await verifyBusiness(config);
  }
  console.log('\n======================================================================');
  console.log('ALL BUSINESS-NEUTRAL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('\nVerification failed with error:', err.message);
  process.exit(1);
});
