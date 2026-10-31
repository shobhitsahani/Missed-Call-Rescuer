export interface BusinessPreset {
  id: string;
  name: string;
  label: string;
  description: string;
  hours: string;
  services: string[];
  faqs: Array<{ question: string; answer: string }>;
  tone: string;
  voice: string;
  language: string;
  timezone: string;
  owner_email: string;
}

export const BUSINESS_PRESETS: Record<string, BusinessPreset> = {
  acme: {
    id: 'biz_1',
    name: 'Acme Plumbing',
    label: 'Example: Acme Plumbing',
    description: 'Plumbing & repair services demo',
    hours: 'Mon-Fri 8am-6pm, Sat 9am-1pm',
    services: [
      'Emergency plumbing',
      'Leak repair',
      'Drain cleaning',
      'Water heater install',
    ],
    faqs: [
      { question: 'Do you offer 24/7 emergency service?', answer: 'Yes, we are available 24/7 for urgent plumbing emergencies.' },
      { question: 'Do you provide free estimates?', answer: 'Yes, we offer free written estimates before any work begins.' },
      { question: 'Are you licensed and insured?', answer: 'Yes, all our plumbers are fully licensed and insured.' },
    ],
    tone: 'friendly, professional, concise',
    voice: 'aai-jane',
    language: 'en',
    timezone: 'Asia/Kolkata',
    owner_email: 'owner@acmeplumbing.example',
  },
  teamFlow: {
    id: 'biz_teamflow',
    name: 'team flow',
    label: 'Example: team flow (Agency)',
    description: 'Software & marketing agency',
    hours: 'Mon-Fri 9am-6pm',
    services: [
      'Software consulting',
      'Web application development',
      'Digital marketing',
      'SEO optimization',
    ],
    faqs: [
      { question: 'What software platforms do you specialize in?', answer: 'We specialize in modern web and cloud applications.' },
      { question: 'Do you offer ongoing retainer packages?', answer: 'Yes, we have monthly support and development retainer plans.' },
    ],
    tone: 'friendly, professional, concise',
    voice: 'aai-jane',
    language: 'en',
    timezone: 'Asia/Kolkata',
    owner_email: 'hello@teamflow.example',
  },
  dentalClinic: {
    id: 'biz_dental',
    name: 'Bright Smiles Dental Clinic',
    label: 'Example: Dental Clinic',
    description: 'Dental care and oral health',
    hours: 'Mon-Fri 8am-5pm, Sat 9am-2pm',
    services: [
      'Routine dental exams & cleaning',
      'Cavity filling',
      'Teeth whitening',
      'Emergency toothache care',
    ],
    faqs: [
      { question: 'Do you accept dental insurance?', answer: 'Yes, we accept most major dental insurance plans.' },
      { question: 'Do you handle dental emergencies?', answer: 'Yes, we offer same-day appointments for urgent dental pain.' },
    ],
    tone: 'calm, helpful, reassuring',
    voice: 'aai-jane',
    language: 'en',
    timezone: 'Asia/Kolkata',
    owner_email: 'care@brightsmiles.example',
  },
  generic: {
    id: 'biz_generic',
    name: 'Example Business',
    label: 'Neutral Demo Business',
    description: 'Generic consultation & support',
    hours: 'Mon-Fri 9am-5pm',
    services: [
      'General consultation',
      'Customer support',
      'Service inquiries',
    ],
    faqs: [
      { question: 'How can I schedule a consultation?', answer: 'Our team will review your preferred time and contact you to confirm.' },
      { question: 'Where can I find more information?', answer: 'Our team will follow up directly with full details.' },
    ],
    tone: 'friendly, professional, concise',
    voice: 'aai-jane',
    language: 'en',
    timezone: 'Asia/Kolkata',
    owner_email: 'contact@example.com',
  },
};

export const DEFAULT_PRESET = BUSINESS_PRESETS.acme;

/**
 * Check if the current business name has been changed from Acme Plumbing,
 * but still has services, FAQs, or hours matching the example Acme Plumbing preset.
 */
export function checkExampleMismatch(
  currentName: string,
  services: string[],
  faqs: Array<{ question: string; answer: string }>,
  hours?: string
): { hasMismatch: boolean; servicesMatch: boolean; faqsMatch: boolean; hoursMatch: boolean } {
  const normName = (currentName || '').trim().toLowerCase();
  const isAcmeName = normName === 'acme plumbing' || normName.includes('plumb');

  const defaultServices = DEFAULT_PRESET.services;
  const defaultFaqs = DEFAULT_PRESET.faqs;
  const defaultHours = DEFAULT_PRESET.hours;

  const servicesMatch =
    services.length > 0 &&
    services.length === defaultServices.length &&
    services.every((s, i) => s.trim().toLowerCase() === defaultServices[i].toLowerCase());

  const faqsMatch =
    faqs.length > 0 &&
    faqs.length === defaultFaqs.length &&
    faqs.every((f, i) => f.question.trim().toLowerCase() === defaultFaqs[i].question.toLowerCase());

  const hoursMatch = typeof hours === 'string' && hours.trim() === defaultHours;

  const hasMismatch = !isAcmeName && (servicesMatch || faqsMatch || hoursMatch);

  return { hasMismatch, servicesMatch, faqsMatch, hoursMatch };
}
