# 图片展示与弹出层实现梳理及 Vue3 移植方案

本文档梳理了cc-desktop-main项目中图片在对话列表里的展示方式、图片弹出层的实现逻辑，并给出一个可迁移到 `Vue3 + TypeScript + Node` 项目的可执行方案。

## 一、当前项目实现概览

当前项目的图片展示主要由以下几个部分组成：

| 功能               | 文件                                                 | 说明                                             |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------ |
| 对话内图片展示     | `desktop/src/components/chat/InlineImageGallery.tsx` | 从消息文本中提取图片路径，并以内联缩略图网格展示 |
| 图片弹出层         | `desktop/src/components/chat/ImageGalleryModal.tsx`  | 点击缩略图后弹出大图预览，支持左右切换           |
| 基础弹窗           | `desktop/src/components/shared/Modal.tsx`            | 基于 Portal 渲染到 `document.body`               |
| Overlay 状态       | `desktop/src/stores/overlayStore.ts`                 | 记录当前全屏覆盖层数量，避免被原生 webview 覆盖  |
| Assistant 消息接入 | `desktop/src/components/chat/AssistantMessage.tsx`   | 在 assistant 消息中渲染 `InlineImageGallery`     |
| Tool 结果接入      | `desktop/src/components/chat/ToolResultBlock.tsx`    | 在 tool result 中渲染 `InlineImageGallery`       |

## 二、图片在对话列表里的展示逻辑

### 1. 文本中提取图片路径

当前项目通过正则从消息文本中提取图片路径。

核心逻辑在：

```tsx
// desktop/src/components/chat/InlineImageGallery.tsx
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export function extractImagePaths(text: string): string[] {
  const regex =
    /(?:^|[\s`"'(])(\/?(?:[A-Za-z]:[\\/]|\/)[^\s`"')<>]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/gim
  const paths: string[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const p = match[1]!.trim()
    if (!seen.has(p) && IMAGE_EXTENSIONS.test(p)) {
      seen.add(p)
      paths.push(p)
    }
  }

  return paths
}
```

它主要支持：

- macOS / Linux 绝对路径，例如：`/Users/demo/output.png`
- Windows 路径，例如：`C:\\Users\\demo\\output.jpg`
- 常见图片后缀：`png`、`jpg`、`jpeg`、`gif`、`webp`、`svg`、`bmp`、`avif`、`ico`
- 去重处理，避免同一图片重复展示

### 2. 图片 URL 转换

浏览器无法直接读取本地绝对路径，所以项目通过后端接口代理访问本地文件。

当前实现：

```tsx
function fileUrl(filePath: string): string {
  return `${getBaseUrl()}/api/filesystem/file?path=${encodeURIComponent(filePath)}`
}
```

也就是说，本地路径：

```text
/Users/demo/output.png
```

会被转换成：

```text
http://localhost:xxxx/api/filesystem/file?path=%2FUsers%2Fdemo%2Foutput.png
```

然后由后端读取文件并返回图片内容。

### 3. 缩略图网格展示

当前展示规则：

- 没有图片：不渲染任何内容
- 1 张图片：单列展示，最大高度 `400px`
- 多张图片：两列网格展示，每张最大高度 `240px`
- 图片使用 `object-cover`
- 鼠标 hover 时显示放大图标
- 底部显示文件名遮罩
- 图片加载失败时隐藏当前图片卡片

核心 JSX：

```tsx
<div className={`grid gap-2 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
  {images.map((img, i) => (
    <button key={img.src} onClick={() => setActiveIndex(i)}>
      <img
        src={img.src}
        alt={img.name}
        loading="lazy"
        className="w-full object-cover"
        style={{ maxHeight: images.length === 1 ? 400 : 240 }}
      />
    </button>
  ))}
</div>
```

## 三、图片弹出层实现逻辑

图片弹出层由 `ImageGalleryModal.tsx` 实现。

### 1. 基础交互

弹出层支持：

- 点击缩略图打开
- 点击遮罩关闭
- ESC 关闭
- 多图时支持左右按钮切换
- 多图时支持键盘 `ArrowLeft` / `ArrowRight` 切换
- 底部缩略图导航

### 2. 当前图片计算

```tsx
const activeImage = images[activeIndex]
```

`activeIndex` 由父组件 `InlineImageGallery` 维护。

### 3. 键盘切换

```tsx
useEffect(() => {
  if (!open || images.length <= 1) return

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSelect((activeIndex - 1 + images.length) % images.length)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSelect((activeIndex + 1) % images.length)
    }
  }

  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [activeIndex, images.length, onSelect, open])
```

这里使用取模实现循环切换：

- 第一张按左键，切到最后一张
- 最后一张按右键，切到第一张

### 4. Modal Portal 实现

基础 Modal 使用 `createPortal` 渲染到 `document.body`：

```tsx
return createPortal(
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="absolute inset-0" onClick={onClose} />
    <div role="dialog" aria-modal="true">
      {children}
    </div>
  </div>,
  document.body
)
```

这样弹窗不会受消息列表 DOM 层级影响。

## 四、Vue3 + TypeScript + Node 移植方案

### 目标结构

建议在 Vue 项目中按以下结构落地：

```text
src/
├── components/
│   ├── Modal.vue
│   ├── ImageGalleryModal.vue
│   └── InlineImageGallery.vue
├── stores/
│   └── overlayStore.ts
└── utils/
    └── imageExtractor.ts

server/
└── routes/
    └── filesystem.ts
```

## 五、Vue3 端实现

### 1. `src/utils/imageExtractor.ts`

```ts
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export type GalleryImage = {
  src: string
  name: string
}

export function extractImagePaths(text: string): string[] {
  const regex =
    /(?:^|[\s`"'(])(\/?(?:[A-Za-z]:[\\/]|\/)[^\s`"')<>]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/gim
  const paths: string[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const filePath = match[1]!.trim()
    if (!seen.has(filePath) && IMAGE_EXTENSIONS.test(filePath)) {
      seen.add(filePath)
      paths.push(filePath)
    }
  }

  return paths
}

export function fileUrl(filePath: string, baseUrl: string): string {
  return `${baseUrl}/api/filesystem/file?path=${encodeURIComponent(filePath)}`
}

export function fileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}
```

### 2. `src/stores/overlayStore.ts`

如果你的 Vue 项目里没有 Electron 原生 webview，可以先不接入这个 store。

如果有类似 webview、iframe、原生窗口覆盖问题，可以使用 Pinia 管理 overlay 状态：

```ts
import { defineStore } from 'pinia'
import { onMounted, onUnmounted } from 'vue'

export const useOverlayStore = defineStore('overlay', {
  state: () => ({
    count: 0,
  }),

  actions: {
    push() {
      this.count += 1
    },

    pop() {
      this.count = Math.max(0, this.count - 1)
    },
  },
})

export function useSuppressBrowserOverlay() {
  const store = useOverlayStore()

  onMounted(() => {
    store.push()
  })

  onUnmounted(() => {
    store.pop()
  })
}
```

### 3. `src/components/Modal.vue`

```vue
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="modal-wrapper">
        <div class="modal-backdrop" @click="$emit('close')" />

        <div
          class="modal-content"
          :style="{ width: `${width}px`, maxWidth: 'calc(100vw - 48px)' }"
          role="dialog"
          aria-modal="true"
        >
          <div v-if="title" class="modal-header">
            <h2>{{ title }}</h2>
            <button type="button" class="modal-close" @click="$emit('close')">×</button>
          </div>

          <div class="modal-body">
            <slot />
          </div>

          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    width?: number
  }>(),
  {
    width: 560,
  }
)

const emit = defineEmits<{
  close: []
}>()

let cleanup: (() => void) | null = null

watch(
  () => props.open,
  open => {
    cleanup?.()
    cleanup = null

    if (!open) return

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') emit('close')
    }

    document.addEventListener('keydown', handleEsc)
    cleanup = () => document.removeEventListener('keydown', handleEsc)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cleanup?.()
})
</script>

<style scoped>
.modal-wrapper {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}

.modal-content {
  position: relative;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 20px;
}

.modal-close {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font-size: 24px;
}

.modal-close:hover {
  background: #f2f2f2;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px 24px;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
```

### 4. `src/components/ImageGalleryModal.vue`

```vue
<template>
  <Modal :open="open" :width="960" @close="$emit('close')">
    <div v-if="activeImage" class="gallery-modal">
      <div class="gallery-header">
        <div class="image-meta">
          <div class="image-name">{{ activeImage.name }}</div>
          <div class="image-count">{{ activeIndex + 1 }} / {{ images.length }}</div>
        </div>

        <div v-if="images.length > 1" class="nav-actions">
          <button type="button" class="nav-button" aria-label="Previous image" @click="selectPrev">
            ‹
          </button>
          <button type="button" class="nav-button" aria-label="Next image" @click="selectNext">
            ›
          </button>
        </div>
      </div>

      <div class="image-stage">
        <img :src="activeImage.src" :alt="activeImage.name" class="main-image" />
      </div>

      <div v-if="images.length > 1" class="thumbnail-list">
        <button
          v-for="(image, index) in images"
          :key="`${image.name}-${index}`"
          type="button"
          :class="['thumbnail-button', { active: index === activeIndex }]"
          @click="$emit('select', index)"
        >
          <img :src="image.src" :alt="image.name" />
        </button>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import Modal from './Modal.vue'
import type { GalleryImage } from '@/utils/imageExtractor'

const props = defineProps<{
  open: boolean
  images: GalleryImage[]
  activeIndex: number
}>()

const emit = defineEmits<{
  close: []
  select: [index: number]
}>()

const activeImage = computed(() => props.images[props.activeIndex])

function selectPrev() {
  emit('select', (props.activeIndex - 1 + props.images.length) % props.images.length)
}

function selectNext() {
  emit('select', (props.activeIndex + 1) % props.images.length)
}

let cleanup: (() => void) | null = null

watch(
  () => [props.open, props.activeIndex, props.images.length] as const,
  ([open]) => {
    cleanup?.()
    cleanup = null

    if (!open || props.images.length <= 1) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        selectPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        selectNext()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    cleanup = () => document.removeEventListener('keydown', handleKeyDown)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cleanup?.()
})
</script>

<style scoped>
.gallery-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.image-meta {
  min-width: 0;
}

.image-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: #222;
}

.image-count {
  margin-top: 4px;
  font-size: 12px;
  color: #777;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-button {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid #ddd;
  background: #fff;
  cursor: pointer;
  font-size: 24px;
  line-height: 1;
}

.nav-button:hover {
  background: #f5f5f5;
}

.image-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 70vh;
  overflow: hidden;
  border-radius: 16px;
  background: #111;
}

.main-image {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.thumbnail-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.thumbnail-button {
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid #ddd;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.thumbnail-button.active {
  border-color: #1677ff;
  box-shadow: 0 0 0 1px #1677ff;
}

.thumbnail-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
```

### 5. `src/components/InlineImageGallery.vue`

```vue
<template>
  <div v-if="images.length > 0" class="inline-image-gallery">
    <div class="gallery-label">
      <span>image</span>
      <span>{{ images.length === 1 ? '1 image' : `${images.length} images` }}</span>
    </div>

    <div :class="['image-grid', { single: images.length === 1 }]">
      <button
        v-for="(image, index) in images"
        :key="image.src"
        type="button"
        class="image-card"
        @click="activeIndex = index"
      >
        <img
          :src="image.src"
          :alt="image.name"
          loading="lazy"
          :style="{ maxHeight: images.length === 1 ? '400px' : '240px' }"
          @error="hideBrokenImage"
        />

        <div class="hover-mask">
          <span class="fullscreen-icon">⛶</span>
        </div>

        <div class="filename-mask">
          <span>{{ image.name }}</span>
        </div>
      </button>
    </div>

    <ImageGalleryModal
      v-if="activeIndex !== null"
      :open="activeIndex !== null"
      :images="images"
      :active-index="activeIndex"
      @close="activeIndex = null"
      @select="activeIndex = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ImageGalleryModal from './ImageGalleryModal.vue'
import { extractImagePaths, fileName, fileUrl } from '@/utils/imageExtractor'

const props = withDefaults(
  defineProps<{
    text: string
    baseUrl?: string
  }>(),
  {
    baseUrl: 'http://localhost:3456',
  }
)

const activeIndex = ref<number | null>(null)

const images = computed(() => {
  return extractImagePaths(props.text).map(path => ({
    src: fileUrl(path, props.baseUrl),
    name: fileName(path),
  }))
})

function hideBrokenImage(event: Event) {
  const image = event.target as HTMLImageElement
  const button = image.closest('button')
  if (button) button.style.display = 'none'
}
</script>

<style scoped>
.inline-image-gallery {
  margin-top: 12px;
}

.gallery-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: #777;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.image-grid.single {
  grid-template-columns: minmax(0, 1fr);
}

.image-card {
  position: relative;
  overflow: hidden;
  border: 1px solid #ddd;
  border-radius: 12px;
  background: #f7f7f7;
  cursor: pointer;
  padding: 0;
  text-align: left;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.image-card:hover {
  border-color: rgba(22, 119, 255, 0.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.image-card img {
  display: block;
  width: 100%;
  object-fit: cover;
}

.hover-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0);
  opacity: 0;
  transition:
    background 0.2s ease,
    opacity 0.2s ease;
}

.image-card:hover .hover-mask {
  background: rgba(0, 0, 0, 0.2);
  opacity: 1;
}

.fullscreen-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #222;
  font-size: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.filename-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24px 10px 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.65), transparent);
  color: rgba(255, 255, 255, 0.95);
  font-size: 10px;
  font-weight: 500;
}

.filename-mask span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

## 六、在 Vue 消息组件中接入

假设你的消息组件是 `MessageItem.vue`：

```vue
<template>
  <div class="message-item">
    <div class="message-content" v-html="renderedContent" />

    <InlineImageGallery :text="message.content" :base-url="apiBaseUrl" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InlineImageGallery from '@/components/InlineImageGallery.vue'

const props = defineProps<{
  message: {
    content: string
  }
}>()

const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3456'

const renderedContent = computed(() => {
  return props.message.content
})
</script>
```

如果你已经有 Markdown 渲染器，只需要把 `InlineImageGallery` 放在 Markdown 内容下方即可。

## 七、Node 后端文件代理接口

前端图片 `src` 最终会访问：

```text
/api/filesystem/file?path=<encoded-file-path>
```

Node 后端需要提供这个接口。

### Express 示例

```ts
import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import mime from 'mime-types'

const router = Router()

router.get('/api/filesystem/file', async (req, res) => {
  try {
    const filePath = req.query.path

    if (typeof filePath !== 'string' || !filePath) {
      return res.status(400).json({ error: 'Missing path parameter' })
    }

    const normalizedPath = path.normalize(filePath)
    const stats = await fs.stat(normalizedPath)

    if (!stats.isFile()) {
      return res.status(404).json({ error: 'Not a file' })
    }

    const content = await fs.readFile(normalizedPath)
    const contentType = mime.lookup(normalizedPath) || 'application/octet-stream'

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(content)
  } catch (error) {
    console.error('File read error:', error)
    res.status(500).json({ error: 'Failed to read file' })
  }
})

export default router
```

### 安全建议

如果另一个项目是本地桌面工具，可以直接按绝对路径读取。

如果是 Web 服务，建议加白名单限制，例如只允许读取工作目录下的文件：

```ts
const workspaceRoot = '/Users/demo/project'
const resolvedPath = path.resolve(filePath)
const resolvedRoot = path.resolve(workspaceRoot)

if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
  return res.status(403).json({ error: 'Access denied' })
}
```

避免任意本地文件被前端通过接口读取。

## 八、移植落地步骤

### Step 1：添加工具函数

新增：

```text
src/utils/imageExtractor.ts
```

完成图片路径提取、文件名提取、后端 URL 生成。

### Step 2：添加基础弹窗

新增：

```text
src/components/Modal.vue
```

使用 Vue `Teleport` 替代 React `createPortal`。

### Step 3：添加图片弹层

新增：

```text
src/components/ImageGalleryModal.vue
```

实现大图预览、左右切换、键盘切换、底部缩略图。

### Step 4：添加内联图片展示

新增：

```text
src/components/InlineImageGallery.vue
```

负责从消息文本中提取图片，并在对话列表里展示缩略图。

### Step 5：消息组件接入

在你的聊天消息组件中添加：

```vue
<InlineImageGallery :text="message.content" :base-url="apiBaseUrl" />
```

建议放在 Markdown 渲染内容之后。

### Step 6：Node 后端增加文件代理接口

新增：

```text
/api/filesystem/file?path=xxx
```

用于把本地图片文件返回给浏览器。

### Step 7：验证场景

至少验证以下场景：

- 消息中没有图片路径时，不展示图片区域
- 消息中有 1 张图片时，单列展示
- 消息中有多张图片时，双列展示
- 点击图片可以打开弹层
- ESC 可以关闭弹层
- 点击遮罩可以关闭弹层
- 左右按钮可以切换图片
- 键盘左右方向键可以切换图片
- 图片加载失败时不会影响消息整体显示

## 九、React 到 Vue3 的对应关系

| React 实现                   | Vue3 实现                                 |
| ---------------------------- | ----------------------------------------- |
| `useState`                   | `ref`                                     |
| `useMemo`                    | `computed`                                |
| `useEffect`                  | `watch` / `onMounted` / `onBeforeUnmount` |
| `createPortal`               | `Teleport`                                |
| `zustand`                    | `pinia`                                   |
| `props.onClose()`            | `emit('close')`                           |
| `className`                  | `class`                                   |
| `style={{ maxHeight: 400 }}` | `:style="{ maxHeight: '400px' }"`         |

## 十、最终效果

移植完成后，对话消息中只要出现图片路径，例如：

```text
图片已生成：/Users/demo/output/result.png
```

前端会自动：

1. 从文本中提取 `/Users/demo/output/result.png`
2. 转换为 `/api/filesystem/file?path=...`
3. 在消息气泡下方展示缩略图
4. 点击缩略图打开图片弹出层
5. 支持大图查看、左右切换和缩略图导航

## 十一、注意事项

1. 如果你的项目只运行在浏览器中，不建议开放任意本地路径读取能力。
2. 如果是 Electron / Tauri / 本地开发工具，可以通过后端或主进程安全代理文件读取。
3. 如果消息内容中已经包含 Markdown 图片语法，可以额外扩展 `extractImagePaths`，支持提取 `![alt](path)`。
4. 如果图片很多，建议后续增加虚拟列表或懒加载优化。
5. 如果需要支持相对路径，需要结合当前会话的工作目录进行路径解析。
