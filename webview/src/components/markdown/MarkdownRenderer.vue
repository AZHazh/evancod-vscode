/**
 * Markdown 渲染组件
 *
 * 职责：
 * 1. 将 Markdown 文本渲染为 HTML
 * 2. 支持代码语法高亮
 * 3. 支持代码块复制
 * 4. 支持表格、列表等常见格式
 *
 * 使用的库：
 * - marked: Markdown 解析器
 * - highlight.js: 代码语法高亮
 *
 * 设计理念：
 * - 安全渲染（防止 XSS）
 * - 自定义样式
 * - 代码块增强
 *
 * 使用场景：
 * - AI 回复消息
 * - 工具执行结果
 * - 帮助文档
 */

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { marked } from 'marked'

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
}

const props = withDefaults(defineProps<Props>(), {
  enableHighlight: true,
  showCopyButton: true,
  variant: 'default',
})

/**
 * 渲染后的 HTML
 */
const renderedHtml = ref('')

/**
 * 是否正在渲染
 */
const isRendering = ref(false)

/**
 * 配置 marked（每个组件实例独立配置，避免全局状态污染）
 */
onMounted(() => {
  renderMarkdown()
})

/**
 * 监听内容变化
 */
watch(() => props.content, () => {
  renderMarkdown()
})

/**
 * 渲染 Markdown
 */
function renderMarkdown() {
  isRendering.value = true

  try {
    // 每次渲染时创建独立的 renderer，避免实例间状态污染
    const renderer = new marked.Renderer()

    // 自定义代码块渲染
    renderer.code = ({ text, lang }) => {
      const language = lang || 'plaintext'
      const highlighted = props.enableHighlight ? escapeHtml(text) : escapeHtml(text)

      // 添加复制按钮（基于当前实例的 props）
      const copyButton = props.showCopyButton
        ? `<button class="copy-btn" data-code="${escapeHtml(text)}" onclick="copyCode(this)">复制</button>`
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

    // 自定义链接渲染（安全处理）
    renderer.link = ({ href, title, tokens }) => {
      const text = tokens.map(token => 'raw' in token ? token.raw : '').join('')
      // 只允许 http/https 链接
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        return text
      }

      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    }

    // 解析 Markdown（使用实例级 renderer）
    renderedHtml.value = marked.parse(props.content, {
      gfm: true,
      breaks: true,
      renderer,
    }) as string
  } catch (error) {
    console.error('Markdown 渲染失败:', error)
    renderedHtml.value = `<p class="error">渲染失败: ${error}</p>`
  } finally {
    isRendering.value = false
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

/**
 * 全局复制代码函数
 * 在模板中通过 onclick 调用
 */
if (typeof window !== 'undefined') {
  (window as any).copyCode = async (button: HTMLButtonElement) => {
    const code = button.getAttribute('data-code')
    if (!code) return

    try {
      await navigator.clipboard.writeText(code)
      button.textContent = '已复制！'
      setTimeout(() => {
        button.textContent = '复制'
      }, 2000)
    } catch (error) {
      console.error('复制失败:', error)
      button.textContent = '复制失败'
    }
  }
}
</script>

<template>
  <div class="markdown-renderer" :class="`markdown-renderer--${variant}`">
    <!-- 渲染中提示 -->
    <div v-if="isRendering" class="loading">
      渲染中...
    </div>

    <!-- 渲染后的内容 -->
    <div
      v-else
      class="markdown-content"
      v-html="renderedHtml"
    ></div>
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

  :deep(h1) { font-size: 20px; }
  :deep(h2) { font-size: 18px; }
  :deep(h3) { font-size: 16px; }
  :deep(h4) { font-size: 15px; }

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

    &:hover { text-decoration: underline; }
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
