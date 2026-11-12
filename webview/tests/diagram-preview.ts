import { createApp, h, ref } from 'vue'
import MarkdownRenderer from '../src/components/markdown/MarkdownRenderer.vue'

const content = ref('```mermaid\nflowchart TD\n A[开始] --> B[完成]')
const streaming = ref(true)
const harness = {
  posted: [] as unknown[],
  copied: '',
  update: (value: string, active = false) => { content.value = value; streaming.value = active },
}
;(window as any).diagramHarness = harness
window.acquireVsCodeApi = () => ({
  postMessage: message => harness.posted.push(message),
  getState: () => undefined,
  setState: () => undefined,
})
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  writeText: async (value: string) => { harness.copied = value },
} })
createApp({ render: () => h(MarkdownRenderer, { content: content.value, streaming: streaming.value }) }).mount('#app')
