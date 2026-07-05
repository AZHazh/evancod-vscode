<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, Maximize2, ImageIcon, ImageOff } from 'lucide-vue-next'
import type { GeneratedImageRef } from '@/types'
import { base64ToDataUrl, type GalleryImage } from '@/utils/imageAttachments'
import ImageGalleryModal from '@/components/common/ImageGalleryModal.vue'

const props = defineProps<{
  isPending?: boolean
  prompt?: string
  image?: GeneratedImageRef
}>()

const src = computed(() => {
  if (!props.image?.base64) return ''
  return base64ToDataUrl(props.image.base64, props.image.mime)
})

const displayName = computed(() => props.image?.name || fileNameFromPath(props.image?.path) || 'generated-image.png')

const galleryImages = computed<GalleryImage[]>(() =>
  src.value ? [{ src: src.value, name: displayName.value }] : []
)

const modalOpen = ref(false)

function fileNameFromPath(path?: string): string {
  if (!path) return ''
  return path.split(/[/\\]/).pop() || ''
}

function openModal() {
  if (src.value) modalOpen.value = true
}

function download() {
  if (!props.image) return
  // 交给扩展侧用系统保存对话框处理：优先复制工作区磁盘文件，base64 作兜底。
  // 相比 webview 沙箱内的 blob 下载更可靠。
  window.vscode?.postMessage({
    type: 'image.save',
    data: {
      path: props.image.path,
      name: displayName.value,
      base64: props.image.base64,
      mime: props.image.mime,
    },
  })
}
</script>

<template>
  <div class="generated-image">
    <!-- 生成中：骨架图 + 动画 -->
    <div v-if="isPending" class="image-skeleton">
      <div class="skeleton-shimmer" />
      <div class="skeleton-label">
        <ImageIcon class="skeleton-icon" />
        <span>正在生成图片…</span>
      </div>
    </div>

    <!-- 生成完成：图片 + 下载 -->
    <div v-else-if="src" class="image-ready">
      <button type="button" class="image-frame" @click="openModal">
        <img :src="src" :alt="displayName" loading="lazy" />
        <div class="hover-mask">
          <span class="fullscreen-icon"><Maximize2 /></span>
        </div>
      </button>

      <div class="image-toolbar">
        <span class="image-name" :title="displayName">{{ displayName }}</span>
        <button type="button" class="download-button" @click="download">
          <Download class="download-icon" />
          <span>下载</span>
        </button>
      </div>
    </div>

    <!-- 完成但图片不可用（存盘失败或源文件丢失） -->
    <div v-else class="image-unavailable">
      <ImageOff class="unavailable-icon" />
      <span>图片不可用{{ image?.path ? '（源文件已丢失）' : '' }}</span>
    </div>

    <ImageGalleryModal v-model="modalOpen" :images="galleryImages" :initial-index="0" />
  </div>
</template>

<style scoped lang="scss">
.generated-image {
  margin-top: 8px;
  max-width: 420px;
}

/* ===== 骨架图 ===== */
.image-skeleton {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 320px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: 12px;
  background: var(--chat-color-surface-container-low, rgba(255, 255, 255, 0.04));
}

.skeleton-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 20%,
    color-mix(in srgb, var(--chat-color-brand, #c084fc) 22%, transparent) 50%,
    transparent 80%
  );
  background-size: 200% 100%;
  animation: image-shimmer 1.4s ease-in-out infinite;
}

.skeleton-label {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--chat-color-text-tertiary);
  font-size: 13px;
}

.skeleton-icon {
  width: 28px;
  height: 28px;
  opacity: 0.7;
  animation: image-pulse 1.4s ease-in-out infinite;
}

@keyframes image-shimmer {
  0% {
    background-position: 180% 0;
  }
  100% {
    background-position: -80% 0;
  }
}

@keyframes image-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.96);
  }
  50% {
    opacity: 0.85;
    transform: scale(1.04);
  }
}

/* ===== 不可用态 ===== */
.image-unavailable {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border: 1px dashed color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: 12px;
  color: var(--chat-color-text-tertiary);
  font-size: 13px;
}

.unavailable-icon {
  width: 18px;
  height: 18px;
  opacity: 0.7;
}

/* ===== 成图 ===== */
.image-frame {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: 12px;
  background: var(--chat-color-surface-container-low, rgba(255, 255, 255, 0.04));
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--vscode-focusBorder) 50%, transparent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
  }

  img {
    display: block;
    width: 100%;
    max-height: 320px;
    object-fit: contain;
    background: rgba(0, 0, 0, 0.15);
  }
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

.image-frame:hover .hover-mask {
  background: rgba(0, 0, 0, 0.24);
  opacity: 1;
}

.fullscreen-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #222;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);

  svg {
    width: 18px;
    height: 18px;
  }
}

.image-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.image-name {
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: var(--chat-radius-full, 999px);
  background: var(--chat-color-surface, transparent);
  color: var(--chat-color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--vscode-focusBorder) 50%, transparent);
    background: var(--chat-color-surface-container-low);
    color: var(--chat-color-text-primary);
  }
}

.download-icon {
  width: 14px;
  height: 14px;
}
</style>
