<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import PermissionRequestBlock from './PermissionRequestBlock.vue'

const chatStore = useChatStore()

function disableLeavingCard(element: Element) {
  element.setAttribute('inert', '')
}
</script>

<template>
  <Transition name="permission-float" mode="out-in" appear @before-leave="disableLeavingCard">
    <section
      v-if="chatStore.pendingPermission"
      :key="`${chatStore.currentSession?.id}:${chatStore.pendingPermission.requestId}`"
      class="permission-dock"
      aria-label="工具授权"
    >
      <PermissionRequestBlock
        v-bind="chatStore.pendingPermission"
        :remaining-count="chatStore.pendingPermissions.length - 1"
      />
    </section>
  </Transition>
</template>

<style scoped lang="scss">
.permission-dock {
  position: relative;
  z-index: 1;
  grid-area: 1 / 1;
  min-height: 0;
  width: fit-content;
  min-width: min(308px, calc(100% - 40px));
  max-width: min(420px, calc(100% - 40px));
  align-self: end;
  justify-self: end;
  margin: 0 20px 10px;
  transform-origin: right bottom;
}

.permission-float-enter-active {
  transition: opacity 280ms ease, transform 360ms cubic-bezier(0.16, 1, 0.3, 1), filter 280ms ease;
}

.permission-float-leave-active {
  pointer-events: none;
  transition: opacity 180ms ease, transform 220ms ease, filter 180ms ease;
}

.permission-float-enter-from {
  opacity: 0;
  transform: translateX(24px) scale(0.97);
  filter: blur(5px);
}

.permission-float-leave-to {
  opacity: 0;
  transform: translateX(12px) scale(0.98);
  filter: blur(4px);
}

@media (prefers-reduced-motion: reduce) {
  .permission-float-enter-active,
  .permission-float-leave-active {
    transition-duration: 1ms;
  }

  .permission-float-enter-from,
  .permission-float-leave-to {
    transform: none;
    filter: none;
  }
}
</style>
