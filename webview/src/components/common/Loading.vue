<template>
  <div class="loading" :class="`size-${size}`">
    <div class="loading-spinner">{{ icon }}</div>
    <p v-if="text" class="loading-text">{{ text }}</p>
  </div>
</template>

<script setup lang="ts">
interface Props {
  size?: 'small' | 'medium' | 'large'
  text?: string
  icon?: string
}

withDefaults(defineProps<Props>(), {
  size: 'medium',
  icon: '⏳'
})
</script>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
}

.loading-spinner {
  display: inline-block;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.loading.size-small .loading-spinner {
  font-size: 24px;
}

.loading.size-medium .loading-spinner {
  font-size: 32px;
}

.loading.size-large .loading-spinner {
  font-size: 48px;
}

.loading-text {
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}
</style>
