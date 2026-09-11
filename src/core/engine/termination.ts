export const DEFAULT_MAX_ITERATIONS = 100

export type QueryTerminationReason =
  | 'model_completed'
  | 'tasks_completed'
  | 'task_incomplete'
  | 'max_iterations'
  | 'no_progress'
  | 'output_limit'
  | 'provider_error'
  | 'user_cancelled'

export function isSuccessfulTermination(reason: QueryTerminationReason): boolean {
  return reason === 'model_completed' || reason === 'tasks_completed'
}
