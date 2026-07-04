# 🚀 开发调试指南

本文档介绍如何启动和调试 Evancod 扩展。

---

## 📋 前置要求

确保已完成以下步骤：

- ✅ Node.js 18+ 已安装
- ✅ VSCode 1.80.0+ 已安装
- ✅ 项目依赖已安装

---

## 🔧 快速启动（推荐）

### 方法 1：使用 VSCode 调试器（最简单）

这是最推荐的方式，支持断点调试和热重载。

#### 步骤：

1. **打开项目**
   ```bash
   cd /Users/mr_an/Documents/vscode-evancod
   code .
   ```

2. **启动 Extension 监听**（Terminal 1）
   ```bash
   npm run watch
   ```
   这会持续监听 Extension 代码变化并自动编译。

3. **启动 Webview 开发服务器**（Terminal 2）
   ```bash
   npm run dev:webview
   ```
   这会启动 Vite 开发服务器（http://localhost:5173），支持热重载。

4. **按 F5 启动调试**
   - 直接按键盘上的 `F5` 键
   - 或者点击 VSCode 左侧的 "Run and Debug" 图标，然后点击绿色播放按钮
   - 或者使用菜单：`Run > Start Debugging`

5. **等待扩展窗口打开**
   - VSCode 会打开一个新的"Extension Development Host"窗口
   - 这个窗口中已经加载了你的扩展

6. **打开 Evancod**
   - 在新窗口中按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Windows/Linux）
   - 输入 `Evancod: 打开聊天` 并回车
   - 或者点击左侧活动栏的 Evancod 图标

---

### 方法 2：手动编译后调试

如果你只想测试一次，不需要热重载：

```bash
# 1. 编译 Extension
npm run compile

# 2. 编译 Webview
npm run build:webview

# 3. 按 F5 启动调试
```

---

## 🐛 调试技巧

### 1. Extension 端调试（Backend）

**设置断点：**
- 在 `.ts` 文件中点击行号左侧设置断点（红点）
- 代码执行到断点时会暂停

**查看调试输出：**
- 打开调试控制台：`View > Debug Console`
- 所有 `console.log()` 输出都会显示在这里

**查看变量：**
- 暂停时在左侧 "Variables" 面板查看
- 鼠标悬停在变量上查看值

### 2. Webview 端调试（Frontend）

**打开开发者工具：**
1. 在 Extension Development Host 窗口中
2. 点击 Evancod 聊天面板
3. 按 `Cmd+Shift+P`，输入 `Developer: Open Webview Developer Tools`
4. 选择 Evancod 的 webview

**查看控制台输出：**
- 所有前端的 `console.log()` 都在 Webview Developer Tools 中
- Vue Devtools 也可以安装使用

### 3. 重启扩展

**代码修改后重启：**
- Extension 代码：在调试工具栏点击重启按钮（绿色循环箭头）
- Webview 代码：保存后自动热重载（如果 `npm run dev:webview` 正在运行）

**完全重启：**
- 停止调试（红色方块按钮）
- 重新按 F5

---

## 📝 开发工作流

### 典型的开发流程：

```bash
# Terminal 1: 启动 Extension 监听
npm run watch

# Terminal 2: 启动 Webview 开发服务器  
npm run dev:webview

# Terminal 3: （可选）查看编译输出
# 保持空闲，用于运行临时命令
```

然后在 VSCode 中：
1. 按 F5 启动调试
2. 修改代码
3. 保存文件
4. Extension 自动重新编译（watch）
5. Webview 自动热重载（dev:webview）
6. 如果 Extension 代码改变，点击重启按钮

---

## 🔍 常见问题

### Q: 按 F5 后没有反应？

**解决方法：**
1. 检查是否在项目根目录打开 VSCode
2. 确保 `.vscode/launch.json` 文件存在
3. 查看输出面板是否有错误信息

### Q: Webview 显示空白页？

**原因：**
- Webview 开发服务器未启动
- 端口 5173 被占用

**解决方法：**
```bash
# 检查 Webview 服务器是否运行
lsof -i :5173

# 如果被占用，杀掉进程
kill -9 <PID>

# 重新启动
npm run dev:webview
```

### Q: 修改代码后没有生效？

**Extension 代码：**
- 确保 `npm run watch` 正在运行
- 点击调试工具栏的重启按钮
- 或者完全停止调试，重新按 F5

**Webview 代码：**
- 确保 `npm run dev:webview` 正在运行
- 刷新 Webview（在 Webview Developer Tools 中按 Cmd+R）

### Q: 编译错误怎么办？

```bash
# 查看完整的编译错误
npm run compile

# 查看具体错误行
npm run compile 2>&1 | grep "error TS"

# 清理并重新编译
rm -rf out
npm run compile
```

### Q: 提示找不到模块？

```bash
# 重新安装依赖
rm -rf node_modules
npm install

# Webview 依赖
cd webview
rm -rf node_modules
npm install
cd ..
```

---

## 🎯 调试场景示例

### 场景 1：调试 Extension 启动流程

1. 在 `src/extension.ts` 的 `activate()` 函数第一行设置断点
2. 按 F5 启动调试
3. 代码会在断点处暂停
4. 按 F10 单步执行，观察初始化流程

### 场景 2：调试工具执行

1. 在工具文件（如 `src/core/tools/file/FileReadTool.ts`）的 `execute()` 方法设置断点
2. 启动扩展
3. 在聊天中让 AI 读取文件
4. 代码会在断点处暂停

### 场景 3：调试 Webview 消息通信

**Backend 断点：**
- `src/services/webview/WebviewManager.ts` 的 `setupMessageHandler()` 方法

**Frontend 断点：**
- `webview/src/main.ts` 的消息监听器
- 在 Webview Developer Tools 的 Sources 面板设置

### 场景 4：调试 UI 组件

1. 打开 Webview Developer Tools
2. 在 Sources 面板找到组件文件（如 `TaskPanel.vue`）
3. 设置断点
4. 触发相关操作

---

## 📊 性能调试

### 查看 Extension 性能

```bash
# 在 Extension Development Host 窗口
Cmd+Shift+P > Developer: Show Running Extensions
```

### 查看内存使用

```bash
# 在 Extension Development Host 窗口  
Cmd+Shift+P > Developer: Open Process Explorer
```

### Webview 性能分析

1. 打开 Webview Developer Tools
2. 切换到 Performance 标签
3. 点击录制按钮
4. 执行操作
5. 停止录制并查看结果

---

## 🚀 生产构建

### 构建扩展包

```bash
# 1. 编译 Extension
npm run compile

# 2. 构建 Webview
npm run build:webview

# 3. 打包扩展
npm run package
```

这会生成 `.vsix` 文件，可以安装到 VSCode：

```bash
code --install-extension vscode-evancod-0.1.0.vsix
```

---

## 📚 相关文档

- [VSCode Extension API](https://code.visualstudio.com/api)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
- [Pinia 文档](https://pinia.vuejs.org/)

---

## 🆘 获取帮助

遇到问题？

1. 查看编译错误信息
2. 检查 VSCode 输出面板（`View > Output`）
3. 查看调试控制台（`View > Debug Console`）
4. 查看 Webview Developer Tools 控制台
5. 搜索 GitHub Issues
6. 提交新 Issue

---

**祝你开发愉快！🎉**
