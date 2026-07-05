<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import type { GalleryImage } from '@/utils/imageAttachments'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    images: GalleryImage[]
    initialIndex?: number
  }>(),
  {
    initialIndex: 0,
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const activeIndex = ref(props.initialIndex)

const activeImage = computed(() => props.images[activeIndex.value])
const hasMultiple = computed(() => props.images.length > 1)

function clampIndex(index: number): number {
  if (props.images.length === 0) return 0
  return (index + props.images.length) % props.images.length
}

function close() {
  emit('update:modelValue', false)
}

function selectPrev() {
  activeIndex.value = clampIndex(activeIndex.value - 1)
}

function selectNext() {
  activeIndex.value = clampIndex(activeIndex.value + 1)
}

function select(index: number) {
  activeIndex.value = clampIndex(index)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (!hasMultiple.value) return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    selectPrev()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    selectNext()
  }
}

let keyboardBound = false

function bindKeyboard() {
  if (keyboardBound) return
  document.addEventListener('keydown', handleKeydown)
  keyboardBound = true
}

function unbindKeyboard() {
  if (!keyboardBound) return
  document.removeEventListener('keydown', handleKeydown)
  keyboardBound = false
}

watch(
  () => props.modelValue,
  open => {
    if (open) {
      activeIndex.value = clampIndex(props.initialIndex)
      bindKeyboard()
    } else {
      unbindKeyboard()
    }
  },
  { immediate: true }
)

onBeforeUnmount(unbindKeyboard)
</script>

<template>
  <Teleport to="body">
    <Transition name="gallery-fade">
      <div v-if="modelValue && activeImage" class="gallery-overlay" @click="close">
        <button class="gallery-close" type="button" aria-label="关闭" @click.stop="close">
          <X />
        </button>

        <button
          v-if="hasMultiple"
          class="gallery-nav gallery-nav--prev"
          type="button"
          aria-label="上一张"
          @click.stop="selectPrev"
        >
          <ChevronLeft />
        </button>

        <div class="gallery-stage" @click.stop>
          <img :src="activeImage.src" :alt="activeImage.name" class="gallery-image" />
          <div class="gallery-meta">
            <span class="gallery-name">{{ activeImage.name }}</span>
            <span v-if="hasMultiple" class="gallery-count">
              {{ activeIndex + 1 }} / {{ images.length }}
            </span>
          </div>
        </div>

        <button
          v-if="hasMultiple"
          class="gallery-nav gallery-nav--next"
          type="button"
          aria-label="下一张"
          @click.stop="selectNext"
        >
          <ChevronRight />
        </button>

        <div v-if="hasMultiple" class="gallery-thumbs" @click.stop>
          <button
            v-for="(image, index) in images"
            :key="`${image.name}-${index}`"
            type="button"
            class="gallery-thumb"
            :class="{ active: index === activeIndex }"
            @click="select(index)"
          >
            <img :src="image.src" :alt="image.name" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.gallery-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 72px;
  background: rgba(0, 0, 0, 0.82);
}

.gallery-close {
  position: absolute;
  top: 20px;
  right: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  svg {
    width: 20px;
    height: 20px;
  }
}

.gallery-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  svg {
    width: 24px;
    height: 24px;
  }

  &--prev {
    left: 20px;
  }

  &--next {
    right: 20px;
  }
}

.gallery-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  max-height: 100%;
  min-height: 0;
}

.gallery-image {
  max-width: 100%;
  max-height: calc(100vh - 200px);
  object-fit: contain;
  border-radius: 8px;
}

.gallery-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
}

.gallery-name {
  overflow: hidden;
  max-width: 60vw;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-count {
  color: rgba(255, 255, 255, 0.6);
}

.gallery-thumbs {
  display: flex;
  gap: 8px;
  max-width: 100%;
  overflow-x: auto;
  padding: 4px;
}

.gallery-thumb {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  padding: 0;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;

  &.active {
    border-color: #ffb29c;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.gallery-fade-enter-active,
.gallery-fade-leave-active {
  transition: opacity 0.18s ease;
}

.gallery-fade-enter-from,
.gallery-fade-leave-to {
  opacity: 0;
}
</style>
