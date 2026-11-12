<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Copy, Download, Maximize2, Minus, Plus, X } from 'lucide-vue-next'
import { copyText } from '@/utils/clipboard'
import { diagramSize, diagramToPng, renderMermaid } from '@/utils/mermaid'
import { useVSCode } from '@/composables/useVSCode'

const props = defineProps<{ source: string; pending?: boolean }>()
const vscode = useVSCode()
const svg = ref('')
const error = ref('')
const actionStatus = ref('')
const rendering = ref(false)
const exporting = ref(false)
const expanded = ref(false)
const zoom = ref(1)
const dark = ref(true)
const closeButton = ref<HTMLButtonElement>()
const modal = ref<HTMLDivElement>()
let previousFocus: HTMLElement | null = null
let observer: MutationObserver | undefined
let generation = 0
let disposed = false
const size = computed(() => svg.value ? diagramSize(svg.value) : { width: 800, height: 450 })

function readTheme() {
  dark.value = !document.body.matches('.vscode-light, .vscode-high-contrast-light')
}

async function render() {
  const current = ++generation
  error.value = ''
  svg.value = ''
  if (props.pending) {
    rendering.value = false
    return
  }
  rendering.value = true
  try {
    const result = await renderMermaid(props.source, dark.value)
    if (!disposed && current === generation) svg.value = result
  } catch (cause) {
    if (!disposed && current === generation) {
      error.value = cause instanceof Error ? cause.message : '流程图渲染失败'
    }
  } finally {
    if (!disposed && current === generation) rendering.value = false
  }
}

watch(() => [props.source, props.pending, dark.value], render)
onMounted(() => {
  readTheme()
  observer = new MutationObserver(readTheme)
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  void render()
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  observer?.disconnect()
  if (expanded.value) previousFocus?.focus()
})

async function copySource() {
  actionStatus.value = await copyText(props.source) ? '已复制代码' : '复制失败，请重试'
}

async function download() {
  if (!svg.value || exporting.value) return
  exporting.value = true
  actionStatus.value = ''
  try {
    const base64 = await diagramToPng(svg.value, dark.value)
    if (!disposed) vscode.postMessage({
      type: 'image.save',
      data: { name: 'mermaid-diagram.png', base64, mime: 'image/png' },
    })
  } catch (cause) {
    actionStatus.value = cause instanceof Error ? cause.message : 'PNG 导出失败'
  } finally {
    exporting.value = false
  }
}

function fit() {
  zoom.value = Math.max(0.1, Math.min(1,
    (window.innerWidth - 96) / size.value.width,
    (window.innerHeight - 160) / size.value.height
  ))
}

async function openPreview() {
  previousFocus = document.activeElement as HTMLElement
  fit()
  expanded.value = true
  await nextTick()
  closeButton.value?.focus()
}

function closePreview() {
  expanded.value = false
  previousFocus?.focus()
}

function handleModalKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    closePreview()
  }
  if (event.key === 'Tab') {
    const buttons = [...(modal.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
</script>

<template>
  <section class="mermaid-diagram" aria-label="Mermaid 流程图">
    <div class="diagram-toolbar">
      <span>Mermaid</span>
      <button type="button" title="复制为代码" @click="copySource"><Copy :size="14" />复制为代码</button>
      <button type="button" :disabled="!svg || exporting" @click="download"><Download :size="14" />{{ exporting ? '转换中…' : '下载 PNG' }}</button>
      <button type="button" title="放大预览" :disabled="!svg" @click="openPreview"><Maximize2 :size="14" />放大</button>
    </div>
    <div v-if="svg" class="diagram-svg" v-html="svg"></div>
    <p v-else-if="pending || rendering" class="diagram-status" role="status">{{ pending ? '正在生成流程图…' : '正在绘制流程图…' }}</p>
    <p v-if="error" class="diagram-error" role="alert">流程图暂时无法显示：{{ error }}</p>
    <p v-if="actionStatus" class="diagram-status" role="status">{{ actionStatus }}</p>

    <Teleport to="body">
      <div v-if="expanded" class="diagram-backdrop" @click.self="closePreview" @keydown="handleModalKey">
        <div ref="modal" class="diagram-modal" role="dialog" aria-modal="true" aria-label="流程图放大预览">
          <div class="diagram-toolbar">
            <span>流程图预览</span>
            <button type="button" title="缩小" @click="zoom = Math.max(0.1, zoom / 1.25)"><Minus :size="16" /></button>
            <button type="button" title="适应窗口" @click="fit">{{ Math.round(zoom * 100) }}%</button>
            <button type="button" title="放大" @click="zoom = Math.min(4, zoom * 1.25)"><Plus :size="16" /></button>
            <button ref="closeButton" type="button" title="关闭预览" @click="closePreview"><X :size="16" /></button>
          </div>
          <div class="diagram-scroll">
            <div class="diagram-preview-svg" :style="{ width: `${size.width * zoom}px` }" v-html="svg"></div>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped lang="scss">
.mermaid-diagram {
  margin: 12px 0;
  border: 1px solid var(--vscode-panel-border, #444);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-editor-foreground, #ddd);
}
.diagram-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-panel-border, #444);
  font-size: 12px;
  > span { flex: 1; padding: 0 4px; }
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    border-radius: 4px;
    padding: 5px;
    color: inherit;
    background: transparent;
    cursor: pointer;
    font: inherit;
    &:hover { background: var(--vscode-toolbar-hoverBackground, #ffffff1a); }
    &:disabled { opacity: 0.45; cursor: default; }
    &:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007acc); }
  }
}
.diagram-svg {
  overflow: auto;
  padding: 16px;
  max-height: 440px;
  text-align: center;
  :deep(svg) { max-width: 100%; height: auto; }
}
.diagram-status, .diagram-error { margin: 8px 12px; font-size: 12px; overflow-wrap: anywhere; }
.diagram-error { color: var(--vscode-errorForeground, #f88); }
.diagram-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0009;
  padding: 24px;
}
.diagram-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border: 1px solid var(--vscode-panel-border, #444);
  border-radius: 8px;
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-editor-foreground, #ddd);
}
.diagram-scroll { flex: 1; overflow: auto; padding: 16px; }
.diagram-preview-svg {
  margin: auto;
  :deep(svg) { display: block; width: 100%; max-width: none !important; height: auto; }
}
</style>
