# ⚡ 快速启动

## 🎯 最快启动方式（3 步）

```bash
# 1. Terminal 1 - 启动 Extension 监听
npm run watch

# 2. Terminal 2 - 启动 Webview 开发服务器
npm run dev:webview

# 3. 在 VSCode 中按 F5
# 会打开新窗口，然后按 Cmd+Shift+P，输入 "Evancod: 打开聊天"
```

---

## 📝 详细步骤

### 第一次启动

1. **打开项目**
   ```bash
   cd /Users/mr_an/Documents/vscode-evancod
   code .
   ```

2. **打开两个终端**
   - Terminal 1: `npm run watch`
   - Terminal 2: `npm run dev:webview`

3. **按 F5 启动调试**
   - VSCode 会打开一个新的"Extension Development Host"窗口

4. **打开 Evancod**
   - 按 `Cmd+Shift+P`
   - 输入 `Evancod: 打开聊天`
   - 或点击左侧活动栏的图标

### 后续启动

如果两个 `npm run watch` 和 `npm run dev:webview` 还在运行：
- 直接按 **F5** 即可！

---

## 🐛 修改代码后

### Extension 代码修改
- 保存文件 → 自动编译（watch 监听）
- 点击调试工具栏的重启按钮（绿色循环箭头）

### Webview 代码修改
- 保存文件 → 自动热重载（无需操作）

---

## ❌ 遇到问题？

### Webview 空白
```bash
# 重启 Webview 服务器
npm run dev:webview
```

### Extension 报错
```bash
# 查看编译错误
npm run compile

# 重新编译
rm -rf out && npm run compile
```

### 彻底重启
1. 停止调试（红色方块按钮）
2. 停止两个终端（Ctrl+C）
3. 重新执行启动步骤

---

## 📚 详细文档

查看 [DEVELOPMENT-GUIDE.md](./DEVELOPMENT-GUIDE.md) 获取完整的开发和调试指南。

---

**就这么简单！🎉**
