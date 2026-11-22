// Mock tool implementations plus their Anthropic tool-use schemas.
// The returns are deterministic enough for demo repeatability but shaped to
// look realistic in spans and judge rationales.

import { randomUUID } from 'crypto';

// ---- search_schedule --------------------------------------------------------

export interface ScheduleSlot {
  topic: string;
  day: 'Day 1 — Leaders' | 'Day 2 — Builders';
  time: string;
  room: string;
  facilitator?: string;
}

const SCHEDULE_FIXTURES: Record<string, ScheduleSlot> = {
  'ai moats': {
    topic: 'AI Moats: What Still Defends in a Model-Commoditised World',
    day: 'Day 1 — Leaders',
    time: '11:30 AM',
    room: 'Main Stage',
    facilitator: 'Vikas Bansal (Groww)',
  },
  'voice agents': {
    topic: 'Voice Agents in Production',
    day: 'Day 1 — Leaders',
    time: '2:15 PM',
    room: 'Workshop Room B',
    facilitator: 'Sangeeta Bavi (Anthropic)',
  },
  speedrun: {
    topic: 'Speedrun Buildathon Kickoff',
    day: 'Day 2 — Builders',
    time: '1:00 PM',
    room: 'Build Hall',
  },
  braindate: {
    topic: 'Brain Date Roundtables',
    day: 'Day 1 — Leaders',
    time: '3:30 PM',
    room: 'Roundtable Zone (11 tables)',
  },
};

export function search_schedule(topic: string): ScheduleSlot {
  const key = topic.trim().toLowerCase();
  // Simple substring match over fixture keys.
  for (const k of Object.keys(SCHEDULE_FIXTURES)) {
    if (key.includes(k) || k.includes(key)) {
      return SCHEDULE_FIXTURES[k];
    }
  }
  // Default fallback — a plausible but generic slot.
  return {
    topic: `Session on "${topic}"`,
    day: 'Day 1 — Leaders',
    time: '10:00 AM',
    room: 'Main Stage',
  };
}

// ---- check_registration ----------------------------------------------------

export interface RegistrationResult {
  status: 'confirmed' | 'waitlisted' | 'not_found';
  pass_type?: string;
}

export function check_registration(email: string): RegistrationResult {
  const e = email.trim().toLowerCase();
  // Deterministic buckets so simulator traffic produces a sensible mix.
  if (e.endsWith('@waitlist.test')) {
    return { status: 'waitlisted', pass_type: 'Community Pass' };
  }
  if (e.endsWith('@notfound.test')) {
    return { status: 'not_found' };
  }
  if (e.includes('builder')) {
    return { status: 'confirmed', pass_type: 'Builders Pass' };
  }
  if (e.includes('reserve')) {
    return { status: 'confirmed', pass_type: 'Reserve Pass' };
  }
  // Default: confirmed Community Pass.
  return { status: 'confirmed', pass_type: 'Community Pass' };
}

// ---- escalate_to_human ------------------------------------------------------

export interface EscalationResult {
  ticket_id: string;
  eta_hours: number;
}

export function escalate_to_human(reason: string): EscalationResult {
  // ETA scales loosely with reason length just to produce some variance.
  const eta = Math.min(24, Math.max(2, Math.round(reason.length / 20)));
  return {
    ticket_id: `TPF-${randomUUID().slice(0, 8).toUpperCase()}`,
    eta_hours: eta,
  };
}

// ---- Anthropic tool schemas -------------------------------------------------

// Shape matches Anthropic Messages API tool definitions.
export const TOOL_SCHEMAS = [
  {
    name: 'search_schedule',
    description:
      'Look up a session slot in the Product Unconference 2026 agenda by topic keyword. Returns the day, time, room and (where known) facilitator.',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'A topic or keyword such as "voice agents", "ai moats", "speedrun".',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'check_registration',
    description:
      "Check an attendee's registration status by email. Returns confirmed / waitlisted / not_found plus pass type if known.",
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'The email address the attendee used to register.',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Escalate the current query to a human organiser. Use when you cannot ground an answer in the KB or when the user explicitly asks for a human.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One-sentence reason for escalation that will be pinned to the ticket.',
        },
      },
      required: ['reason'],
    },
  },
] as const;

// Dispatch helper used by the agent loop.
export function runTool(
  name: string,
  input: Record<string, any>,
): unknown {
  switch (name) {
    case 'search_schedule':
      return search_schedule(String(input.topic ?? ''));
    case 'check_registration':
      return check_registration(String(input.email ?? ''));
    case 'escalate_to_human':
      return escalate_to_human(String(input.reason ?? ''));
    default:
      return { error: `unknown tool: ${name}` };
  }
}
