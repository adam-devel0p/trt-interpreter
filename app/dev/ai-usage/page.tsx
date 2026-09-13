import { describeProviderConfig } from '@/ai';
import { priceFor } from '@/ai/pricing';
import { aiUsageSince, recentAiCalls } from '@/db/admin';
import { PageHeader } from '@/ui/components/page-header';

export const dynamic = 'force-dynamic';

const fmtUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;

/**
 * Cost and reliability telemetry (§13, §16): calls, tokens, cost, p50/p95 latency and error
 * classes by task and model, from `ai_calls`. The table holds no content, so neither does this
 * page. Dev only.
 */
export default async function DevAiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: raw } = await searchParams;
  const days = Math.min(90, Math.max(1, Number(raw) || 7));
  const [rows, recent, provider] = await Promise.all([
    aiUsageSince(days),
    recentAiCalls(25),
    describeProviderConfig(),
  ]);
  const totalCost = rows.reduce((s, r) => s + r.costMicros, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);

  return (
    <>
      <PageHeader
        title="AI usage"
        eyebrow="dev only"
        description={`Last ${days} days · provider ${provider.provider} · ${totalCalls} calls · ${fmtUsd(totalCost)}`}
      />
      <p className="mb-4 text-sm text-fg-muted">
        Window:{' '}
        {[1, 7, 30, 90].map((d) => (
          <a key={d} href={`?days=${d}`} className="mr-2 text-accent underline underline-offset-4">
            {d}d
          </a>
        ))}
      </p>

      <div
        className="overflow-x-auto"
        tabIndex={0}
        aria-label="Calls by task and model, scrollable"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Calls by task and model</caption>
          <thead className="text-left text-xs text-fg-muted uppercase">
            <tr>
              <th className="py-1 pr-3">Task</th>
              <th className="py-1 pr-3">Model</th>
              <th className="py-1 pr-3 text-right">Calls</th>
              <th className="py-1 pr-3 text-right">OK</th>
              <th className="py-1 pr-3 text-right">Tokens in / out</th>
              <th className="py-1 pr-3 text-right">Cost</th>
              <th className="py-1 pr-3 text-right">p50 / p95 ms</th>
              <th className="py-1 pr-3">Errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-3 text-fg-muted">
                  No calls in this window.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={`${r.task}-${r.modelId}`} className="border-t border-hairline">
                <td className="py-1.5 pr-3 font-medium">{r.task}</td>
                <td className="py-1.5 pr-3">
                  {r.modelId}
                  {priceFor(r.modelId) ? '' : <span className="text-fg-faint"> (no price)</span>}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.calls}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.ok}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {r.tokensIn} / {r.tokensOut}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{fmtUsd(r.costMicros)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {r.p50LatencyMs} / {r.p95LatencyMs}
                </td>
                <td className="py-1.5 pr-3 text-xs">
                  {Object.entries(r.errorClasses)
                    .map(([k, v]) => `${k} ×${v}`)
                    .join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-2 font-serif text-xl">Recent calls</h2>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Most recent calls, scrollable">
        <table className="w-full text-sm">
          <caption className="sr-only">Most recent calls</caption>
          <thead className="text-left text-xs text-fg-muted uppercase">
            <tr>
              <th className="py-1 pr-3">When</th>
              <th className="py-1 pr-3">Task</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Error</th>
              <th className="py-1 pr-3 text-right">Attempts</th>
              <th className="py-1 pr-3 text-right">ms</th>
              <th className="py-1 pr-3">Objects</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id} className="border-t border-hairline">
                <td className="py-1 pr-3 tabular-nums">{c.createdAt.toISOString().slice(0, 19)}</td>
                <td className="py-1 pr-3">{c.task}</td>
                <td className="py-1 pr-3">{c.status}</td>
                <td className="py-1 pr-3">{c.errorClass ?? '—'}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.attempts}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.latencyMs}</td>
                <td className="py-1 pr-3 text-xs text-fg-muted">
                  {(c.objectRefs as { type: string; id: string }[])
                    .map((o) => `${o.type}:${o.id.slice(0, 8)}`)
                    .join(' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
