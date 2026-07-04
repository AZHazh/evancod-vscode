# cc-desktop-main 对话区 UI 样式总览

本文只整理对话区的视觉风格，不解释业务逻辑。目标是让你在另一个项目里按这份文档直接复刻同类 Agent 对话 UI。

## 1. 整体视觉基调

这一套对话区不是“单纯聊天气泡”，而是“Agent 工作台”的聊天流。它的共同特征是：

- 低饱和、低对比、语义化分层。
- 工具调用、结果、授权、计划、提问都以卡片形态嵌入对话流。
- 文本内容和结构化内容使用不同的容器风格。
- 默认是收敛的 compact 样式，必要时再展开到 document / detailed 视图。
- 状态通过颜色、边框、图标、标题条和小 badge 表达，不靠大面积装饰。

核心视觉变量集中在 `desktop/src/theme/globals.css`，尤其是：

- `--color-surface-*`
- `--color-text-*`
- `--color-border`
- `--color-outline-variant`
- `--color-brand`
- `--color-warning`
- `--color-error`
- `--color-success`
- `--color-terminal-*`
- `--color-code-*`
- `--color-diff-*`
- `--color-memory-*`

## 2. 消息区总布局

总入口是 `desktop/src/components/chat/MessageList.tsx`。它负责把不同 `UIMessage.type` 组装成实际 UI 块。

布局规律：

- 用户消息右对齐。
- 助手消息左对齐。
- 思考、工具、权限、任务、计划、提问都插入在主对话流中。
- 长内容会以 `document` 风格铺满宽度，而不是继续保留窄气泡。
- 消息之间有明显垂直间距，常见是 `mb-4` / `mb-5` / `mb-2` 这类节奏。
- 消息内容区统一用圆角、细边框、轻阴影、低饱和背景。

### 2.1 消息流容器

`MessageList` 外层是一个可滚动区域，内部又有一个居中的内容宽度限制。

- 桌面主阅读宽度通常是 `max-w-[860px]`。
- 紧凑模式会放宽到 `max-w-full`。
- 底部有 `StreamingIndicator`、`CompactStatusDivider`、`CurrentTurnChangeCard` 等辅助块。
- 长对话会走虚拟化和 `content-visibility`，但视觉上仍维持统一间距。

### 2.2 消息排序与嵌套

- `tool_use` 和 `tool_result` 会被聚合成工具组或工具树。
- `assistant_text` 与 `tool_use` 之间不会硬塞分隔标题，重点是连续流式呈现。
- `task_summary`、`memory_event`、`goal_event`、`background_task`、`compact_summary` 这类非文本事件，也以卡片方式嵌在流里。

## 3. 用户消息样式

组件：`desktop/src/components/chat/UserMessage.tsx`

### 外层布局

- 右对齐。
- 容器宽度通常是 `max-w-[82%]`，在更大屏幕下会进一步收窄到 `sm:max-w-[78%]`、`lg:max-w-[72%]`。
- 附件先于文本渲染。
- 文本存在时再显示 action bar。

### 文本气泡

- 背景使用 `--color-surface-user-msg`。
- 字号 `text-sm`。
- 行高 `leading-relaxed`。
- 文本自动换行，允许长单词断行：`whitespace-pre-wrap break-words`，并且显式设置 `overflowWrap: anywhere`、`wordBreak: break-word`。
- 圆角是非对称的：`18px 4px 18px 18px`，右上角更尖，形成明显的发送气泡感。
- 风格上没有过多阴影，偏稳重、安静。

### Action bar

- 只有有文本时才显示。
- 默认隐藏，hover / focus-within 时显现。
- 复制、分支、时间戳都放在这一层。

## 4. 助手消息样式

组件：`desktop/src/components/chat/AssistantMessage.tsx`

### 外层布局

- 左对齐。
- 默认宽度是 `max-w-[88%]`，响应式降到 `sm:max-w-[80%]`、`lg:max-w-[72%]`。
- 当内容满足文档特征时，切成 `document` layout，直接 `w-full max-w-full`。
- 助手内容区会跟随对话宽度变化，但不超过页面主流阅读宽度。

### 气泡样式

- 背景使用 `--color-surface`。
- 边框使用细边框 `border-[var(--color-border)]/60`。
- 圆角为 `rounded-[20px] rounded-tl-[8px]`，左上更尖，和用户气泡形成镜像感。
- 有很轻的 `shadow-sm`。
- 正文通过 `MarkdownRenderer` 渲染，支持代码块、列表、标题、引用等。

### 流式状态

- streaming 时尾部显示一个细条光标：`h-4 w-0.5 animate-shimmer bg-[var(--color-brand)]`。
- 这个光标非常克制，不会像传统打字机效果那样占视觉中心。

### 附件和输出目标

- 图片、视频、输出目标卡片都附着在助手消息下方。
- 输出目标超出数量后只显示摘要行，不堆太多卡片。

### Action bar

- 和用户消息类似，默认隐藏，hover / focus-within 时显示。
- 默认对齐在左侧。

## 5. Thinking 样式

组件：`desktop/src/components/chat/ThinkingBlock.tsx`

### 折叠态

- 默认只显示一行标题。
- 左侧有小三角图标，表示展开状态。
- 标题用斜体、细字重、低对比色。
- 标题尾部在 active 状态会出现点状动画。

### 展开态

- 展开内容是一个低对比容器：
  - `rounded-lg`
  - `border border-[var(--color-border)]/40`
  - `bg-[var(--color-surface-container-lowest)]`
  - `text-[11px]`
- 容器有最大高度 `max-h-[300px]`，超出可滚动。
- Markdown 渲染使用 compact 模式。
- active thinking 时底部带一根 blinking cursor。

### 总体感觉

Thinking 不应该像“系统日志”，也不应该像“正文”。它更像一段可展开的中性色解释层，克制、可读、低干扰。

## 6. 工具调用样式

### 单个工具卡

组件：`desktop/src/components/chat/ToolCallBlock.tsx`

这是最核心的工具视觉单元。

#### 外壳

- `overflow-hidden rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-surface-container-lowest)]`
- 整体比普通文本更像“面板”，但仍然紧贴消息流。
- 不是大面积插画式卡片，而是信息密度高的小工具块。

#### 顶部标题行

- 左侧是工具图标。
- 中间是工具名。
- 后面跟路径、摘要、pending 状态、结果摘要、错误图标、展开箭头。
- 标题行 hover 时会轻微变色，但不会强交互化。

#### pending 状态

- 右侧显示 spinner + 短文本。
- 这里的文案非常短，目的是提示“正在生成/准备工具”，而不是解释太多。

#### 结果状态

- 成功结果显示简短摘要。
- 错误结果显示红色 error icon 和红色摘要。
- 展开后再看详细输出。

#### 展开区

- 顶部分隔线之后显示正文。
- 内部通常会嵌套 diff、代码、终端、计划预览或纯文本结果。

### Bash 工具

- Bash 预览使用终端壳。
- 命令正文等宽字体、低字号、深色背景。
- 如果需要更像 shell，会显示 `$` 提示符。
- Bash 在整套工具里是最“终端感”的表现。

### Read / Write / Edit

- `Edit` 和 `Write` 优先走 `DiffViewer`。
- `Read` 通常展示结果文本。
- 文件路径和摘要会优先放在标题行，不把输入表单做得很重。

### Agent 工具

- Agent 工具和普通工具不同，会以分组或树状方式展示。
- 通常有子调用缩进、状态 badge、运行中提示、结果摘要。
- 视觉上更像“嵌套任务流”，而不是单一命令卡。

### Skill / MCP 工具

- Skill 在工具卡里使用 `auto_awesome` 类图标。
- MCP 工具没有独立大面积视觉语法，本质仍是工具卡，但标题、摘要、结果会更依赖工具名和状态文案。
- 这两类工具在视觉上都服从同一套工具卡框架，而不是另起炉灶。

## 7. 工具分组样式

组件：`desktop/src/components/chat/ToolCallGroup.tsx`

### 普通工具组

- 工具组外层仍然是低对比卡片。
- 多个同类工具会聚合成一个摘要标题。
- 单个工具可直接展开，不一定需要额外组壳。

### Agent 树状调用

- Agent 调用会呈现树状层级。
- 子调用通过缩进和左侧引导线区分。
- 运行中、完成、失败、停止会使用不同颜色和状态标记。
- 视觉重点是“层级关系”而不是“单次命令”。

### Memory 工具活动

- 记忆相关工具会使用专门的 memory 颜色体系。
- 外壳更像专属状态卡，而不是普通工具卡。
- 这种卡片强调“已保存 / 已引用”的结果，而不是命令输入。

## 8. 工具结果样式

组件：`desktop/src/components/chat/ToolResultBlock.tsx`

- 外层是 `rounded-xl border` 的结果容器。
- 成功和错误使用不同的标题条或底色语义。
- 结果内容通常以等宽字体展示。
- 长内容可以展开或折叠。
- 这个组件适合显示“单独的结果块”，但很多场景会嵌在工具卡里一起出现。

## 9. 代码块样式

组件：`desktop/src/components/chat/CodeViewer.tsx`

### 基本风格

- 深浅统一的代码容器，不花哨。
- 背景使用 `--color-code-bg`。
- 语法高亮采用 warm 系列配色。
- 字号固定为 `12px` 左右，等宽字体。
- 行高紧凑，大约 `1.3`。

### 代码区

- 最多 `max-h-[420px]`，超长滚动。
- 可显示行号。
- 行号是低对比的辅助信息。
- 复制按钮通常放在头部。

### 语法主题

- 注释偏灰、字符串偏暖、关键字偏品牌色、数字和类型各有区分。
- 总体不是高饱和 IDE 风格，而是更适合嵌入对话区的轻语法强调。

## 10. Diff 样式

组件：`desktop/src/components/chat/DiffViewer.tsx`

### 外层

- `rounded-[var(--radius-lg)] border border-[var(--color-outline-variant)]/50 bg-[var(--color-surface-container-low)]`
- 比代码块更偏“审阅面板”。

### Header

- 顶部显示文件路径。
- 同时展示 additions / deletions 的小胶囊。
- 右侧有 Copy path 按钮。

### Diff 区域

- 最大高度 `max-h-[400px]`。
- 使用 word diff，适合小粒度编辑场景。
- 语义色：新增和删除都有自己的背景色、文字色、gutter 色。
- 整体仍然克制，不会占据整屏。

## 11. 终端样式

组件：`desktop/src/components/chat/TerminalChrome.tsx`

这是 Bash 工具和某些结果块最典型的外壳。

### 标题栏

- macOS 风格三色按钮。
- 标题栏背景和内容区有明显分层。
- 标题使用很小的等宽字体。

### 内容区

- 深色背景。
- 等宽字体。
- 颜色和 terminal 语义变量绑定。
- 和代码块相比，它更强调“运行环境”的感觉，而不是“源码阅读”的感觉。

## 12. 权限 / 授权样式

组件：`desktop/src/components/chat/PermissionDialog.tsx`

### 整体形态

- 权限卡是聊天流中的普通卡片，不是全屏弹窗。
- 它通常有更明显的边框和状态色。
- Pending 时更强调“等待用户决定”，已响应时变得低调。

### Header

- 左侧工具图标。
- 右侧是状态 badge：awaiting approval / responded。
- 标题一般是“允许某个工具做什么”。
- 描述行较短，避免信息压迫。

### 预览区

- 如果是 Edit / Write，会展示 diff。
- 如果是 Bash，会展示终端命令。
- 如果没有特殊预览，只显示原始输入摘要。

### 原始输入

- 默认收起。
- 可展开查看 raw JSON。
- raw 区域使用终端底色和等宽字体。

### 按钮区

- 底部固定三类操作：Allow、Allow for session、Deny。
- 这组按钮是明确的决策动作，不做成普通文本链接。
- 按钮样式偏简洁，避免喧宾夺主。

## 13. AskUserQuestion 样式

组件：`desktop/src/components/chat/AskUserQuestion.tsx`

- 结构更接近“聊天内表单卡片”。
- 顶部有 help 图标和标题。
- 多问题时会出现横向 tab bar。
- 选项卡像可点击条目，带选中态边框和背景变化。
- 输入框和按钮都保持品牌语义，但不做夸张强调。
- 已提交后整体会变淡，进入 answered / completed 态。

这个组件的视觉意义很重要：它说明对话区不只是显示文本，也要承载结构化用户输入。

## 14. Plan Mode 样式

组件：`desktop/src/components/chat/PlanModePreview.tsx`

### 计划卡

- 外层是单独的 plan preview card。
- 顶部有 plan 标题、文件路径、品牌色图标。
- 正文是 markdown 计划内容。
- 计划卡最大高度较高，支持滚动。

### 权限段

- 如果存在允许的 prompt，会单独列在底部权限区。
- 每条 prompt 用小边框块展示。
- 整体是“可审阅方案”而不是“普通聊天回复”。

## 15. 任务 / 变更 / 输出目标样式

### 任务摘要

组件：`desktop/src/components/chat/InlineTaskSummary.tsx`

- 浅底卡片。
- 顶部是任务统计和状态。
- 下面是任务条目列表。
- 完成项会变淡或带删除线。

### 当前回合变更卡

组件：`desktop/src/components/chat/CurrentTurnChangeCard.tsx`

- 更偏审阅面板。
- 顶部显示插入/删除统计和 undo。
- 文件列表行风格紧凑，适合快速浏览。

### 助手输出目标卡

组件：`desktop/src/components/chat/AssistantOutputTargetCard.tsx`

- 以目标图标 + 标题 + badge + 操作按钮的形式出现。
- 比普通工具卡更像“结果落点卡”。

## 16. 附件、图片、视频样式

### 附件

组件：`desktop/src/components/chat/AttachmentGallery.tsx`

- composer 里的附件更像紧凑缩略条。
- 消息里的附件更像内容卡片或缩略图网格。
- 仍然使用圆角、浅边框、低对比背景。

### 图片

组件：`desktop/src/components/chat/InlineImageGallery.tsx`

- 缩略图带边框和圆角。
- 支持点击打开预览。
- 多图时采用网格而不是堆叠。

### 视频

- 和图片的风格一致，但呈现更克制，避免抢占聊天主体。

## 17. 消息操作条样式

组件：`desktop/src/components/chat/MessageActionBar.tsx`

- 默认隐藏。
- hover / focus-within 时出现。
- 按钮是小圆形图标按钮。
- 复制、分支、时间戳都很轻，不干扰内容阅读。
- 对移动端或 touch 场景会更容易常显。

## 18. 过渡 / 状态 / 辅助提示

### StreamingIndicator

组件：`desktop/src/components/chat/StreamingIndicator.tsx`

它负责把“模型还在工作”显示成一个轻提示条。

#### 常规态

- 是一个小圆角 pill，不占太多横向空间。
- 左侧有 shimmer 星形/闪光符号。
- 中间显示 verb，例如 Working / Thinking / Running。
- 右侧可显示 elapsed time 和 token 估算。

#### API retry 态

- 变成 amber 警示横幅。
- 带 spinner、重试次数、HTTP 状态或错误类型、倒计时。
- 这是更强提醒，不再是轻提示。

#### streaming fallback 态

- 变成中性小 pill。
- 文案说明是“非流式响应等待”。
- 用于区分真正失败和正常降级等待。

### CompactStatusDivider

- 以横向分割线 + 居中标题的方式出现。
- 适合压缩上下文后的分隔。
- 展开后显示摘要和元信息。

### Goal / Memory / Background task

- 这些都是辅助状态卡。
- 风格通常比主对话更轻、更窄、更强调状态标签。
- 它们不抢主消息的视觉权重，但会让 Agent 状态在流里可见。

## 19. 对话区里应该迁移的最小样式单元

如果你要在另一个项目里直接复刻，建议只迁移这几个基础单元：

1. 用户消息气泡：右对齐、非对称圆角、深一点的用户背景。
2. 助手消息气泡：左对齐、文档模式切换、轻边框浅底。
3. Thinking 折叠块：一行标题 + 展开内容 + active cursor。
4. 工具卡：标题行 + 状态 badge + 展开区 + 结果区。
5. 终端壳：三色灯 + 深色内容区。
6. 代码块：浅语法高亮 + 行号 + 复制按钮 + 高度限制。
7. Diff：文件头 + 增删统计 + word diff。
8. 权限卡：awaiting / responded 状态、raw 输入、预览、三按钮决策。
9. AskUserQuestion：表单化聊天卡。
10. Plan 卡：计划内容 + 允许 prompt 列表。
11. Task / turn change / output target 这些辅助卡片。
12. StreamingIndicator / CompactDivider / Goal / Memory / Background task 这些状态提示。
13. 消息 action bar：hover 显示、复制、branch、时间戳。

## 20. 结构化落地顺序

如果你准备在另一个项目里照着实现，推荐按下面顺序做：

1. 先定对话流容器：宽度、间距、左右对齐、滚动区域、虚拟化策略。
2. 再实现用户消息和助手消息两种基础气泡。
3. 接着加 thinking、action bar、StreamingIndicator。
4. 然后补工具卡、终端、代码块、diff。
5. 再补权限卡、AskUserQuestion、Plan 卡。
6. 最后补 Task / Memory / Goal / Background task / CurrentTurnChangeCard 这些辅助卡。

这套顺序最稳，因为它先把“消息长什么样”做对，再补“Agent 状态怎么表达”。

## 21. 一句话总结

这套对话区样式的核心不是“漂亮”，而是“把 Agent 的每个状态都变成可读、可操作、低噪声的结构化视觉块”。
