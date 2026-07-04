# VSCode Evancod

AI-powered coding agent for Visual Studio Code, based on Claude.

## 🚀 Features

- 💬 Interactive chat interface with AI assistant
- 🛠️ 50+ built-in tools (file operations, bash execution, web search, etc.)
- 🔌 Multi-provider support (Anthropic, AWS Bedrock, Google Vertex AI, Azure OpenAI, custom endpoints)
- 🔄 new-api token sync
- 🧠 Cross-session memory system
- 📡 MCP (Model Context Protocol) support
- 🎨 Beautiful Vue 3 UI with SCSS styling

## 📋 Prerequisites

- Node.js 18+
- VSCode 1.80.0+

## 🔧 Development Setup

### 1. Install dependencies

**Extension:**
```bash
npm install
```

**Webview:**
```bash
cd webview
npm install
```

### 2. Start development

**Terminal 1 - Watch Extension:**
```bash
npm run watch
```

**Terminal 2 - Dev Webview:**
```bash
npm run dev:webview
```

**Terminal 3 - Run Extension:**
Press `F5` in VSCode to start debugging

### 3. Build for production

```bash
# Build webview
npm run build:webview

# Compile extension
npm run compile

# Package extension
npm run package
```

## 📁 Project Structure

```
vscode-evancod/
├── src/                      # Extension Host (TypeScript)
│   ├── extension.ts          # Entry point
│   ├── services/
│   │   ├── chat/            # Chat service
│   │   ├── provider/        # Provider management
│   │   ├── webview/         # Webview manager
│   │   └── ui/              # UI services
│   └── types/               # TypeScript types
├── webview/                  # Webview UI (Vue 3)
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── views/           # Page views
│   │   ├── components/      # Vue components
│   │   ├── stores/          # Pinia stores
│   │   ├── composables/     # Composables
│   │   └── styles/          # SCSS styles
│   └── package.json
├── out/                      # Compiled extension output
├── package.json              # Extension manifest
└── tsconfig.json
```

## 🎯 Commands

- `Evancod: 打开聊天` - Open chat panel
- `Evancod: 新建会话` - Create new session
- `Evancod: 同步 new-api` - Sync tokens from new-api

## ⚙️ Configuration

Configure in VSCode settings:

- `evancod.model` - Default model to use
- `evancod.effortLevel` - Inference effort level (low/medium/high)
- `evancod.permissionMode` - Permission mode (default/acceptEdits/plan/bypassPermissions)

## 📝 Provider Configuration

Providers are stored in `~/.claude/cc-evancod/providers.json` (compatible with Desktop version).

## 🔗 Related Projects

- [cc-desktop-main](https://github.com/your-repo) - Desktop version (Electron)

## 📄 License

MIT

## 🙏 Credits

Based on Claude Code architecture and design patterns.
