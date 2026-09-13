import type { InterpretationRow } from '@/db/queries/interpretations';
import type { SafetyClassification } from '@/domain/safety/categories';

/** What the interpretation service emits; the route turns these into SSE frames verbatim. */
export type ServiceEvent =
  | { type: 'started'; interpretationId: string; collapsedByDefault: boolean }
  | {
      type: 'safety';
      category: SafetyClassification['category'];
      severity: SafetyClassification['severity'];
    }
  | { type: 'text'; text: string }
  | { type: 'reset' }
  | { type: 'complete'; interpretation: InterpretationRow }
  | {
      type: 'failed';
      interpretationId: string;
      errorClass: string;
      /** User-facing copy: what happened, what is safe, what to do next. */
      message: string;
    };
