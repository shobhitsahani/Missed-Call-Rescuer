export interface VoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  accent: string;
  description: string;
}

export const ASSEMBLYAI_VOICES: VoiceOption[] = [
  { id: 'aai-jane', name: 'Jane', gender: 'female', accent: 'American', description: 'Warm, natural, clear (Recommended)' },
  { id: 'aai-sara', name: 'Sara', gender: 'female', accent: 'American', description: 'Friendly and professional' },
  { id: 'aai-anna', name: 'Anna', gender: 'female', accent: 'American', description: 'Direct and confident' },
  { id: 'aai-alba', name: 'Alba', gender: 'female', accent: 'American', description: 'Calm and conversational' },
  { id: 'aai-eve', name: 'Eve', gender: 'female', accent: 'American', description: 'Bright and energetic' },
  { id: 'aai-mary', name: 'Mary', gender: 'female', accent: 'American', description: 'Smooth and reassuring' },
  { id: 'aai-vera', name: 'Vera', gender: 'female', accent: 'American', description: 'Clear and measured' },
  { id: 'aai-jean', name: 'Jean', gender: 'female', accent: 'American', description: 'Warm and empathetic' },
  { id: 'aai-michael', name: 'Michael', gender: 'male', accent: 'American', description: 'Authoritative and steady' },
  { id: 'aai-paul', name: 'Paul', gender: 'male', accent: 'American', description: 'Casual and friendly' },
  { id: 'aai-charles', name: 'Charles', gender: 'male', accent: 'American', description: 'Deep and professional' },
  { id: 'aai-george', name: 'George', gender: 'male', accent: 'American', description: 'Clear and approachable' },
];

export const VALID_VOICE_IDS = new Set(ASSEMBLYAI_VOICES.map((v) => v.id));

export function isValidVoiceId(id: string): boolean {
  return VALID_VOICE_IDS.has(id);
}
