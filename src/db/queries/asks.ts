import type { UserClient } from '@/db/client';
import type { AskScope } from '@/domain/retrieval/query';

/**
 * Ask My History rows (spec §6.6, §16), as the user through RLS. A session may insert the
 * question (`pending`, no answer) and set its own feedback; the pipeline completes the row
 * through the service role (`src/retrieval/ask.ts`). Opening a stored ask reads this row and
 * the cited objects — no model call.
 */

export interface AskCitation {
  object_type: 'reading' | 'life_event';
  object_id: string;
  label: string;
}

export interface AskClaim {
  text: string;
  citations: AskCitation[];
}

export interface AskRow {
  id: string;
  question: string;
  scope: AskScope;
  status: 'pending' | 'complete' | 'failed';
  error_class: string | null;
  answer: string | null;
  claims: AskClaim[] | null;
  citations: AskCitation[] | null;
  evidence_sufficient: boolean | null;
  found: string | null;
  narrower_question: string | null;
  package_object_ids: { type: string; id: string }[] | null;
  dropped_object_ids: { type: string; id: string }[] | null;
  model_id: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  latency_ms: number | null;
  feedback: -1 | 1 | null;
  created_at: string;
  completed_at: string | null;
}

export const ASK_COLUMNS =
  'id, question, scope, status, error_class, answer, claims, citations, evidence_sufficient, found, narrower_question, package_object_ids, dropped_object_ids, model_id, prompt_version, schema_version, latency_ms, feedback, created_at, completed_at';

export class AskError extends Error {
  override name = 'AskError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function createAsk(
  client: UserClient,
  input: { userId: string; question: string; scope: AskScope },
): Promise<{ id: string }> {
  const { data, error } = await client
    .from('asks')
    .insert({
      user_id: input.userId,
      question: input.question,
      scope: input.scope,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw new AskError('ask insert failed', error.code);
  return { id: (data as { id: string }).id };
}

export async function getAsk(client: UserClient, id: string): Promise<AskRow | null> {
  const { data, error } = await client.from('asks').select(ASK_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new AskError('ask read failed', error.code);
  return (data as AskRow | null) ?? null;
}

export async function listAsks(client: UserClient, limit = 20): Promise<AskRow[]> {
  const { data, error } = await client
    .from('asks')
    .select(ASK_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new AskError('ask list failed', error.code);
  return (data ?? []) as AskRow[];
}

export async function setAskFeedback(
  client: UserClient,
  id: string,
  feedback: -1 | 1 | null,
): Promise<void> {
  const { error } = await client
    .from('asks')
    .update({ feedback, feedback_at: feedback === null ? null : new Date().toISOString() })
    .eq('id', id);
  if (error) throw new AskError('ask feedback failed', error.code);
}

export async function deleteAsk(client: UserClient, id: string): Promise<void> {
  const { error } = await client.from('asks').delete().eq('id', id);
  if (error) throw new AskError('ask delete failed', error.code);
}
