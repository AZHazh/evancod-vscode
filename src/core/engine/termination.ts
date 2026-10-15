export const DEFAULT_MAX_ITERATIONS = 100
export const DEFAULT_MAX_EXECUTION_SEGMENTS = 10

export interface ExecutionSegmentContinuationState {
  taskWorkflowActive: boolean
  unfinishedTaskCount: number
  progressSignals: number
  consecutiveNoProgressTurns: number
  currentSegment: number
  maxSegments: number
}

/**
 * 轮数上限是执行段检查点，不是结构化任务的完成条件。
 * 只有仍有任务、当前段确实取得进展且总预算尚未耗尽时才自动续段。
 */
export function shouldContinueExecutionSegment(
  state: ExecutionSegmentContinuationState
): boolean {
  return (
    state.taskWorkflowActive &&
    state.unfinishedTaskCount > 0 &&
    state.progressSignals > 0 &&
    state.consecutiveNoProgressTurns < 2 &&
    state.currentSegment < state.maxSegments
  )
}

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
