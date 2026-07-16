/**
 * 并发控制工具
 *
 * 为什么需要它：
 * 遍历类工具（grep/find/list）如果用 for-of + await 串行处理每个文件，
 * 每一步都要等上一步的系统调用返回，累积延迟很高。改成并发能把等待重叠起来。
 * 但无上限并发又会瞬间打开成千上万个文件句柄导致 EMFILE，所以需要一个带上限的并发池。
 */

/**
 * 以受限并发对数组逐项执行异步任务，保持结果与输入顺序一致。
 *
 * @param items - 输入项
 * @param limit - 最大并发数
 * @param worker - 处理单项的异步函数，(item, index) => Promise<R>
 * @returns 与 items 等长、顺序一致的结果数组
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results

  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  async function run(): Promise<void> {
    let current = nextIndex++
    while (current < items.length) {
      results[current] = await worker(items[current], current)
      current = nextIndex++
    }
  }

  // 启动 concurrency 个 worker，它们共享同一个游标(nextIndex)竞争取任务
  await Promise.all(Array.from({ length: concurrency }, () => run()))
  return results
}
