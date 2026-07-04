<template>
  <div class="composer-drop-overlay">
    <strong>释放文件添加到对话</strong>
  </div>
</template>

<style scoped lang="scss">
.composer-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--vscode-focusBorder);
  border-radius: 18px;
  background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent);
  color: var(--color-text-primary);
  pointer-events: none;
}
</style>
