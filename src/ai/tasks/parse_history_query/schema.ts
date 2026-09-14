/**
 * `parse_history_query` output: the domain owns the shape (docs/ALGORITHMS.md §4 step 1) so
 * the pipeline, the mock and the eval share one definition.
 */
export {
  HISTORY_INTENTS,
  HISTORY_QUERY_SCHEMA_VERSION,
  historyQuerySchema,
  type HistoryIntent,
  type HistoryQuery,
} from '@/domain/retrieval/query';
