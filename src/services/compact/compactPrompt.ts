/**
 * 上下文压缩提示词
 * 基于文档 §2.4 的 9 段结构
 */
export function getCompactPrompt(): string {
  return `Summarize the conversation above into a checkpoint for another coding assistant. Do not continue the task or call tools. Output only the checkpoint.

Preserve exact user constraints and corrections, file paths, tool names and arguments, errors, identifiers, and evidence for conclusions. Distinguish confirmed facts from hypotheses. Keep completed work completed. Merge a previous checkpoint with newer facts, discard stale facts, and do not copy previous checkpoints verbatim. Image placeholders describe omitted images; do not invent their contents.

Summary:
1. Primary Request and Intent:
[用户的核心请求是什么？他们想要实现什么目标？]

2. Key Technical Concepts:
[讨论中涉及的关键技术概念、架构、设计模式]

3. Files and Code Sections:
[涉及的文件路径、关键代码段、修改内容]

4. Errors and fixes:
[遇到的错误、调试过程、最终修复方案]

5. Problem Solving:
[解决问题的思路、尝试的方案、为什么有效]

6. All user messages:
[按时间顺序列出用户的所有消息要点]

7. Pending Tasks:
[尚未完成的任务、下一步计划]

8. Current Work:
[压缩前最后正在进行的工作]

9. Optional Next Step:
[建议的下一步操作]

Do not invent transcript paths or claim verification that did not occur. Keep the checkpoint concise and retain all nine sections.`
}
