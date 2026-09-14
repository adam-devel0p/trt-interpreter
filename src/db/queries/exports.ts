/**
 * Export requests and deletion receipts through the RLS-respecting user client (FR-22, §19).
 * A user can ask for an export and read their own history; the archive is attached by the
 * `export_user_data` job and handed out only through a short-lived signed URL
 * (`src/db/admin`). Export is available on every plan (invariant 11).
 */
import type { UserClient } from '@/db/client';

export class ExportQueryError extends Error {
  override name = 'ExportQueryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Fifteen minutes between exports keeps the queue honest without ever refusing the data. */
export const EXPORT_COOLDOWN_MS = 15 * 60_000;

export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export interface ExportRequestRow {
  id: string;
  user_id: string;
  status: ExportStatus;
  format: 'json_v1';
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  counts: Record<string, number> | null;
  error_class: string | null;
  job_id: string | null;
}

const COLUMNS =
  'id, user_id, status, format, requested_at, completed_at, expires_at, storage_path, size_bytes, ' +
  'counts, error_class, job_id';

/** A new queued request as the user; the policy refuses anything but the owner's own row. */
export async function requestExport(client: UserClient, userId: string): Promise<string> {
  const { data, error } = await client
    .from('exports')
    .insert({ user_id: userId, status: 'queued', format: 'json_v1' })
    .select('id')
    .single();
  if (error) throw new ExportQueryError('export request failed', error.code);
  return (data as { id: string }).id;
}

export async function listExports(client: UserClient, limit = 5): Promise<ExportRequestRow[]> {
  const { data, error } = await client
    .from('exports')
    .select(COLUMNS)
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) throw new ExportQueryError('exports read failed', error.code);
  return (data ?? []) as unknown as ExportRequestRow[];
}

export async function getExport(client: UserClient, id: string): Promise<ExportRequestRow | null> {
  const { data, error } = await client.from('exports').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new ExportQueryError('export read failed', error.code);
  return (data as unknown as ExportRequestRow | null) ?? null;
}

/** True when a request is still in flight — one at a time keeps the queue honest. */
export function hasPendingExport(rows: readonly ExportRequestRow[]): boolean {
  return rows.some((r) => r.status === 'queued' || r.status === 'running');
}

// ── Deletion receipts (§19) ───────────────────────────────────────────────────────────────

export interface DeletionReceiptRow {
  id: string;
  scope: 'reading' | 'life_event' | 'ai_artifacts' | 'history' | 'account';
  object_type: string | null;
  object_id: string | null;
  requested_at: string;
  completed_at: string;
  counts: Record<string, number>;
}

export async function listDeletionReceipts(
  client: UserClient,
  limit = 5,
): Promise<DeletionReceiptRow[]> {
  const { data, error } = await client
    .from('deletion_receipts')
    .select('id, scope, object_type, object_id, requested_at, completed_at, counts')
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) throw new ExportQueryError('receipts read failed', error.code);
  return (data ?? []) as unknown as DeletionReceiptRow[];
}
