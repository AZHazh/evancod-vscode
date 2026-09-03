/** * Markdown 渲染组件 * * 职责： * 1. 将 Markdown 文本渲染为 HTML * 2. 支持代码语法高亮 * 3.
支持代码块复制 * 4. 支持表格、列表等常见格式 * * 使用的库： * - marked: Markdown 解析器 * -
highlight.js: 代码语法高亮 * * 设计理念： * - 安全渲染（防止 XSS） * - 自定义样式 * - 代码块增强 * *
使用场景： * - AI 回复消息 * - 工具执行结果 * - 帮助文档 */

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { marked } from 'marked'
import { copyText } from '@/utils/clipboard'

/**
 * 组件 Props
 */
interface Props {
  /**
   * Markdown 内容
   */
  content: string

  /**
   * 是否启用代码高亮（可选）
   * 默认：true
   */
  enableHighlight?: boolean

  /**
   * 是否显示复制按钮（可选）
   * 默认：true
   */
  showCopyButton?: boolean

  variant?: 'default' | 'document' | 'compact'

  /** 流式阶段使用轻量纯文本，完成后再做完整 Markdown 解析。 */
  streaming?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  enableHighlight: true,
  showCopyButton: true,
  variant: 'default',
  streaming: false,
})

/**
 * 渲染后的 HTML
 */
const renderedHtml = ref('')

/**
 * 性能优化：在组件生命周期内复用 Renderer 实例
 *
 * 原代码每次渲染都 new marked.Renderer() 并重新设置 code/link 方法。
 * 现在每个组件实例只初始化一次，后续渲染持续复用，减少对象分配。
 */
const sharedRenderer = new marked.Renderer()

sharedRenderer.code = ({ text, lang }) => {
  const language = lang || 'plaintext'
  const highlighted = escapeHtml(text)

  const copyButton =
    props.showCopyButton && language !== 'plaintext'
      ? `<button type="button" class="copy-btn" data-code="${escapeHtml(text)}">复制</button>`
      : ''

  return `
    <div class="code-block">
      <div class="code-header">
        <span class="code-lang">${escapeHtml(language)}</span>
        ${copyButton}
      </div>
      <pre><code class="language-${escapeHtml(language)}">${highlighted}</code></pre>
    </div>
  `
}

sharedRenderer.link = ({ href, title, tokens }) => {
  const text = tokens.map(token => ('raw' in token ? token.raw : '')).join('')
  if (!href.startsWith('http://') && !href.startsWith('https://')) {
    return `<a href="#" data-file-path="${escapeHtml(href)}">${text}</a>`
  }

  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}

sharedRenderer.codespan = ({ text }) => {
  const value = text.trim()
  const fileAttr = /(?:^|[\\/])[^\\/\n]+\.[A-Za-z0-9]{1,8}$/.test(value)
    ? ` data-file-path="${escapeHtml(value)}"`
    : ''
  return `<code${fileAttr}>${escapeHtml(text)}</code>`
}

/**
 * 渲染节流定时器
 *
 * 原代码用 rAF 合并：虽然比无节流好，但每帧（~16ms）都执行一次完整的
 * marked.parse()。当内容超过几百字时单次 parse 耗时可达 10-30ms，
 * 直接占满主线程、拖垮虚拟滚动测量。
 *
 * 改为滑动窗口合并：~100ms 内多次变化只触发一次渲染，大幅降低 parse 频率。
 * 100ms 在用户感知上是连续的，不会出现打字卡顿感。
 */
let renderTimer = 0
const RENDER_THROTTLE_MS = 100

function scheduleRender() {
  if (renderTimer) return
  renderTimer = window.setTimeout(() => {
    renderTimer = 0
    renderMarkdown()
  }, RENDER_THROTTLE_MS)
}

onMounted(() => {
  if (!props.streaming) {
    renderMarkdown()
  }
})

/**
 * 非流式内容继续使用节流渲染；流式结束时立即生成最终 Markdown。
 */
watch(
  () => [props.content, props.streaming] as const,
  ([, streaming], [, previousStreaming]) => {
    if (streaming) {
      if (renderTimer) {
        window.clearTimeout(renderTimer)
        renderTimer = 0
      }
      return
    }

    if (previousStreaming) {
      renderMarkdown()
      return
    }

    scheduleRender()
  }
)

onBeforeUnmount(() => {
  if (renderTimer) window.clearTimeout(renderTimer)
})

/**
 * 渲染 Markdown
 */
function renderMarkdown() {
  try {
    renderedHtml.value = marked.parse(props.content, {
      gfm: true,
      breaks: true,
      renderer: sharedRenderer,
    }) as string
  } catch (error) {
    console.error('Markdown 渲染失败:', error)
    renderedHtml.value = `<p class="error">渲染失败: ${error}</p>`
  }
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, m => map[m])
}

async function handleRenderedClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('.copy-btn')
  if (!button) return

  event.preventDefault()
  event.stopPropagation()
  const code = button.dataset.code || ''
  if (!code) return

  const copied = await copyText(code)
  button.textContent = copied ? '已复制！' : '复制失败'
  if (copied) {
    window.setTimeout(() => {
      button.textContent = '复制'
    }, 2000)
  }
}
</script>

<template>
  <div class="markdown-renderer" :class="`markdown-renderer--${variant}`">
    <div v-if="streaming" class="markdown-content markdown-content--streaming">{{ content }}</div>
    <div v-else class="markdown-content" v-html="renderedHtml" @click="handleRenderedClick"></div>
  </div>
</template>

<style scoped lang="scss">
.markdown-renderer {
  width: 100%;
  color: var(--chat-color-text-primary);
  font-size: 14px;
  line-height: 1.625;
}

.markdown-renderer--compact {
  font-size: 12px;
  line-height: 1.5;
}

.loading {
  padding: 8px 0;
  color: var(--chat-color-text-tertiary);
  font-style: italic;
}

.markdown-content {
  word-wrap: break-word;

  :deep(> :first-child) {
    margin-top: 0;
  }

  :deep(> :last-child) {
    margin-bottom: 0;
  }

  :deep(p) {
    margin: 0.5em 0;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 1em 0 0.45em;
    font-weight: 650;
    line-height: 1.25;
  }

  :deep(h1) {
    font-size: 20px;
  }
  :deep(h2) {
    font-size: 18px;
  }
  :deep(h3) {
    font-size: 16px;
  }
  :deep(h4) {
    font-size: 15px;
  }

  :deep(ul),
  :deep(ol) {
    margin: 0.5em 0;
    padding-left: 1.4em;
  }

  :deep(li + li) {
    margin-top: 0.25em;
  }

  :deep(blockquote) {
    margin: 0.75em 0;
    padding-left: 12px;
    border-left: 3px solid var(--chat-color-border);
    color: var(--chat-color-text-secondary);
  }

  :deep(code:not(pre code)) {
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
    border-radius: 5px;
    background: var(--chat-color-surface-container-low);
    font-family: var(--chat-font-mono);
    font-size: 0.9em;
  }

  :deep(.code-block) {
    margin: 0.75em 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 50%, transparent);
    border-radius: var(--chat-radius-lg);
    background: var(--chat-color-surface-container-low);
  }

  :deep(.code-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
    background: var(--chat-color-surface-container);
    color: var(--chat-color-text-tertiary);
    font-size: 11px;
  }

  :deep(.code-lang) {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  :deep(.copy-btn) {
    padding: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--chat-color-outline-variant) 40%, transparent);
    border-radius: 6px;
    background: var(--chat-color-surface-container-lowest);
    color: var(--chat-color-text-tertiary);
    cursor: pointer;
    font-size: 11px;

    &:hover {
      background: var(--chat-color-surface-container-high);
      color: var(--chat-color-text-primary);
    }
  }

  :deep(pre) {
    max-height: 420px;
    margin: 0;
    overflow: auto;
    padding: 8px 12px;
    background: var(--chat-color-code-bg);
    color: var(--chat-color-code-fg);
    font-family: var(--chat-font-mono);
    font-size: 12px;
    line-height: 1.3;
    white-space: pre;
  }

  :deep(a) {
    color: var(--chat-color-text-accent);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(table) {
    width: 100%;
    margin: 0.75em 0;
    border-collapse: collapse;
    font-size: 13px;
  }

  :deep(th),
  :deep(td) {
    padding: 6px 8px;
    border: 1px solid var(--chat-color-border);
  }

  :deep(th) {
    background: var(--chat-color-surface-container-low);
    font-weight: 600;
  }

  :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--chat-radius-sm);
    margin: 0.75em 0;
  }
  :deep(.language-plaintext) {
    background-color: transparent;
  }
}

.markdown-content--streaming {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.markdown-renderer--compact .markdown-content {
  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(pre),
  :deep(blockquote) {
    margin-top: 0.35em;
    margin-bottom: 0.35em;
  }
}
</style>
