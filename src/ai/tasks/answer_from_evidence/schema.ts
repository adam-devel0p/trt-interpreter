/**
 * `answer_from_evidence` output: the domain owns the shape and the verifier
 * (docs/ALGORITHMS.md §4 steps 6–7) so the pipeline, the mock and the eval share them.
 */
export {
  CITATION_LABEL,
  HISTORY_ANSWER_SCHEMA_VERSION,
  historyAnswerSchema,
  type HistoryAnswer,
} from '@/domain/retrieval/answer';
