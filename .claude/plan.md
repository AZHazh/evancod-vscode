# 修复 openai_image Provider 直接生图路径

## 问题

当用户将 `apiFormat: 'openai_image'` 的 Provider 设为激活，发送消息时：
- `ChatService` 照常初始化 `QueryEngine`
- `createApiClient()` 没有 `openai_image` 分支，fall-through 到 `AnthropicClient`
- `AnthropicClient` 用 Anthropic 协议请求 OpenAI 图片 API → 协议不匹配 → 报错崩溃
- 骨架屏没显示（`image_gen` 工具从未被调用）
- 图片 URL 泄漏为 assistant 文本 → CSP 阻止

## 设计意图

当激活 Provider 是 `openai_image` 格式时，用户输入的文本直接作为 prompt 调用图片生成 API，不走 LLM 对话流。

## 修复方案

在 `ChatService.sendMessage()` 中，`queryEngine.query()` 之前检测 Provider 格式，走专用路径。

### 修改文件

#### 1. 新建 `src/core/tools/image/imageUtils.ts`

提取可复用函数：
- `buildOpenAIImageUrl(baseUrl: string): string` — 拼接图片生成端点
- `downloadAsBase64(url: string): Promise<string | undefined>` — 下载远程图片转 base64

#### 2. 修改 `src/core/tools/image/ImageGenTool.ts`

引用 `imageUtils.ts` 中的函数，去掉内部重复实现。

#### 3. 修改 `src/services/chat/ChatService.ts`

- 在 `sendMessage()` 中 `queryEngine.query()` 之前加入判断：

```typescript
const provider = this.providerService.getActiveProvider()
if (provider?.apiFormat === 'openai_image') {
  await this.handleDirectImageGeneration(commandResult.content, session, provider)
  return
}
```

- 新增 `handleDirectImageGeneration()` 方法，流程：
  1. 生成 imageId，发 `image_generation { phase: 'start' }` 事件 → 骨架屏
  2. 构建请求体（model/prompt/n/size/quality/response_format）
  3. fetch 图片 API（`/v1/images/generations`）
  4. 解析响应，download URL → base64（或直接取 b64_json）
  5. 保存到磁盘（`saveGeneratedImages` + `timestampedImagePath`）
  6. 发 `image_generation { phase: 'complete', image }` 事件 → 前端展示图片
  7. 发 `message_complete` 事件
  8. 记录 transcript（`image_generation` block）
  9. 保存会话

### 不需要修改的文件

- 前端代码（`GeneratedImageBlock.vue`、store `upsertImageGeneration` 已完整支持该事件流）
- `AnthropicClient.ts`（`openai_image` 不经过它）
- CSP 配置（图片以 base64 data URL 展示）

### 事件流程（前端已支持）

```
image_generation { phase: 'start', imageId }       → 骨架屏动画
image_generation { phase: 'complete', imageId, image } → 展示图片
message_complete                                    → 标记回合结束
```
