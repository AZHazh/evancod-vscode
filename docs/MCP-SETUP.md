# MCP (Model Context Protocol) 设置指南

## 什么是 MCP？

MCP (Model Context Protocol) 是一个标准协议，允许 AI 助手连接外部工具和数据源。通过 MCP，Evancod 可以访问：

- 文件系统
- 数据库（PostgreSQL, SQLite, MySQL）
- API 服务（GitHub, Google Drive, Slack）
- 浏览器自动化（Puppeteer）
- 搜索引擎（Brave Search）
- 自定义工具

## 配置 MCP 服务器

### 1. 创建配置文件

创建配置文件：`~/.claude/cc-evancod/mcp-servers.json`

```bash
mkdir -p ~/.claude/cc-evancod
touch ~/.claude/cc-evancod/mcp-servers.json
```

### 2. 配置文件格式

```json
{
  "mcpServers": {
    "server-name": {
      "command": "命令",
      "args": ["参数1", "参数2"],
      "env": {
        "ENV_VAR": "值"
      }
    }
  }
}
```

### 3. 常见 MCP 服务器配置

#### 文件系统访问

允许 AI 访问指定目录：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"],
      "env": {}
    }
  }
}
```

#### GitHub 集成

访问 GitHub API（需要 Personal Access Token）：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

获取 GitHub Token：
1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 选择权限：`repo`, `read:org`, `read:user`
4. 复制生成的 token

#### PostgreSQL 数据库

连接 PostgreSQL 数据库：

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://username:password@localhost:5432/database"
      ],
      "env": {}
    }
  }
}
```

#### SQLite 数据库

访问本地 SQLite 数据库：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/database.db"],
      "env": {}
    }
  }
}
```

#### 浏览器自动化（Puppeteer）

控制浏览器进行自动化操作：

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
      "env": {}
    }
  }
}
```

#### Brave Search

使用 Brave Search API 进行网页搜索：

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

获取 Brave API Key：
1. 访问 https://brave.com/search/api/
2. 注册账号
3. 创建 API Key

### 4. 完整配置示例

参考 `docs/mcp-servers.example.json` 查看完整配置示例。

## 使用 MCP 工具

配置完成后，AI 可以使用以下 MCP 工具：

### `mcp_call_tool`

调用 MCP 服务器提供的工具：

```typescript
// AI 会自动调用
mcp_call_tool({
  server: "github",
  tool: "create_issue",
  arguments: {
    repo: "owner/repo",
    title: "Bug report",
    body: "Description"
  }
})
```

### `mcp_read_resource`

读取 MCP 资源：

```typescript
// AI 会自动调用
mcp_read_resource({
  server: "github",
  uri: "github://owner/repo/issues/123"
})
```

### `mcp_list_tools`

列出可用的 MCP 工具：

```typescript
mcp_list_tools({ server: "github" })
```

### `mcp_list_resources`

列出可用的 MCP 资源：

```typescript
mcp_list_resources({ server: "github" })
```

## 故障排查

### 问题：MCP 服务器无法连接

**解决方法：**

1. 检查配置文件格式是否正确（有效的 JSON）
2. 确认 `npx` 命令可用（运行 `npx --version`）
3. 检查环境变量是否正确设置
4. 查看 VSCode 开发者控制台的错误信息（`Help > Toggle Developer Tools`）

### 问题：权限不足

**解决方法：**

1. 检查 API Token 权限是否足够
2. 对于文件系统服务器，确保目录路径存在且有访问权限
3. 对于数据库服务器，确认连接字符串和凭据正确

### 问题：工具未显示

**解决方法：**

1. 重新启动 VSCode
2. 运行命令 `Evancod: Reload MCP Servers`
3. 检查 MCP 服务器是否正常运行

## 创建自定义 MCP 服务器

你可以创建自己的 MCP 服务器来扩展 Evancod 的能力。

参考官方文档：https://modelcontextprotocol.io/

## 安全建议

1. **不要在配置文件中直接存储敏感信息**
   - 使用环境变量：`"env": { "TOKEN": "${GITHUB_TOKEN}" }`
   - 在 `.zshrc` 或 `.bashrc` 中设置环境变量

2. **限制文件系统访问范围**
   - 只授予必要的目录访问权限
   - 避免授予根目录访问权限

3. **定期更新 API Token**
   - 设置 Token 过期时间
   - 使用最小权限原则

4. **审查第三方 MCP 服务器代码**
   - 只使用可信来源的服务器
   - 检查服务器的网络请求

## 常见 MCP 服务器列表

- `@modelcontextprotocol/server-filesystem` - 文件系统访问
- `@modelcontextprotocol/server-github` - GitHub 集成
- `@modelcontextprotocol/server-postgres` - PostgreSQL 数据库
- `@modelcontextprotocol/server-sqlite` - SQLite 数据库
- `@modelcontextprotocol/server-puppeteer` - 浏览器自动化
- `@modelcontextprotocol/server-brave-search` - Brave 搜索
- `@modelcontextprotocol/server-google-drive` - Google Drive
- `@modelcontextprotocol/server-slack` - Slack 集成

完整列表：https://github.com/modelcontextprotocol/servers

## 更多帮助

- MCP 官方文档：https://modelcontextprotocol.io/
- Evancod 文档：https://github.com/yourusername/vscode-evancod
- 问题反馈：https://github.com/yourusername/vscode-evancod/issues
