/**
 * The layered interpretation schema lives in domain/ so the UI and query layer can share it
 * without importing src/ai/. Re-exported here as the task's output contract.
 */
export {
  interpretationOutputSchema,
  modelInterpretationSchema,
  type InterpretationOutput,
  type ModelInterpretation,
  type PerCard,
} from '@/domain/interpretation/schema';
