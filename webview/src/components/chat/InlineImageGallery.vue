<script setup lang="ts">
import { computed, ref } from 'vue'
import { Maximize2 } from 'lucide-vue-next'
import type { AttachmentContext } from '@/types'
import { galleryImagesFromAttachments } from '@/utils/imageAttachments'
import ImageGalleryModal from '@/components/common/ImageGalleryModal.vue'

const props = defineProps<{
  attachments?: AttachmentContext[]
}>()

const images = computed(() => galleryImagesFromAttachments(props.attachments))

const modalOpen = ref(false)
const activeIndex = ref(0)

function openAt(index: number) {
  activeIndex.value = index
  modalOpen.value = true
}

function hideBrokenImage(event: Event) {
  const image = event.target as HTMLImageElement
  const card = image.closest('.image-card') as HTMLElement | null
  if (card) card.style.display = 'none'
}
</script>

<template>
  <div v-if="images.length > 0" class="inline-image-gallery">
    <div :class="['image-grid', { single: images.length === 1 }]">
      <button
        v-for="(image, index) in images"
        :key="`${image.name}-${index}`"
        type="button"
        class="image-card"
        @click="openAt(index)"
      >
        <img
          :src="image.src"
          :alt="image.name"
          loading="lazy"
          :style="{ maxHeight: images.length === 1 ? '320px' : '200px' }"
          @error="hideBrokenImage"
        />

        <div class="hover-mask">
          <span class="fullscreen-icon"><Maximize2 /></span>
        </div>

        <div class="filename-mask">
          <span>{{ image.name }}</span>
        </div>
      </button>
    </div>

    <ImageGalleryModal
      v-model="modalOpen"
      :images="images"
      :initial-index="activeIndex"
    />
  </div>
</template>

<style scoped lang="scss">
.inline-image-gallery {
  margin-top: 8px;
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
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
  border-radius: 12px;
  background: var(--color-surface-container-low, rgba(255, 255, 255, 0.04));
  cursor: pointer;
  text-align: left;
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
    object-fit: cover;
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

.image-card:hover .hover-mask {
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

.filename-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20px 10px 6px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.65), transparent);
  color: rgba(255, 255, 255, 0.95);
  font-size: 11px;

  span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
