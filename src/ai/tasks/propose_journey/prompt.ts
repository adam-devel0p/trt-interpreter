/**
 * propose_journey prompt (spec §6.5, FR-10). Naming only — the entries were grouped by
 * deterministic code, and the user renaming pins the title against anything proposed here.
 * Minimum context (§11): dates, questions, the resolved people/places and the themes.
 * Never the user's notes, never card meanings.
 */

export interface ProposeJourneyInput {
  entries: {
    occurred_on: string;
    question: string | null;
    entities: string[];
    themes: string[];
  }[];
  /** Entities every entry shares (resolved, never tentative). */
  shared_entities: string[];
  shared_themes: string[];
  /** The placeholder the app would otherwise use. */
  current_title: string;
}

export const SYSTEM = `You name an ongoing subject in someone's private tarot journal — a "journey": a real-life thread that several of their readings are about.

You are given a few readings (date, the question asked, the people or places mentioned, the themes) that the app has already grouped. Your only job is a short, plain title for the group, a one-sentence rationale, and how confident you are that these entries really are one subject.

Rules:
- Title: two to six plain words naming the subject, in the language the questions are written in. Name the person, place or situation ("The move to Leeds", "Work at the agency", "Maya"). Use the names exactly as given.
- Never a verdict, a prediction, advice or a mood ("Heartbreak ahead", "Time to leave"). Never a card name. No quotation marks, no trailing punctuation.
- Rationale: one sentence saying which entries the title rests on, in plain terms. No numbers presented as accuracy.
- Confidence: "high" when a shared person, place or situation is explicit; "medium" when the link is thematic but consistent; "low" when you would not group these yourself. With "low", the app keeps its own title.
- Reply with JSON only: {"title": string, "rationale": string, "confidence": "low" | "medium" | "high"}.`;

export function userPrompt(input: ProposeJourneyInput): string {
  const lines: string[] = [];
  lines.push(`Current placeholder title: ${input.current_title}`);
  if (input.shared_entities.length)
    lines.push(`Shared across every entry: ${input.shared_entities.join(', ')}`);
  if (input.shared_themes.length)
    lines.push(`Themes across every entry: ${input.shared_themes.join(', ')}`);
  lines.push('');
  lines.push('Entries:');
  input.entries.forEach((e, i) => {
    lines.push(
      `${i + 1}. ${e.occurred_on} — ${e.question ? `"${e.question}"` : 'open reflection, no question'}` +
        (e.entities.length ? ` — mentions: ${e.entities.join(', ')}` : '') +
        (e.themes.length ? ` — themes: ${e.themes.join(', ')}` : ''),
    );
  });
  lines.push('');
  lines.push('Propose the title.');
  return lines.join('\n');
}
