# MCP 设置指南

Evancod 使用官方 `@modelcontextprotocol/sdk` 连接标准 MCP Server。当前支持 stdio，远程 Streamable HTTP 作为后续扩展。

## 设置界面

打开聊天顶部的“设置”，选择“MCP Server”。可以新增、编辑、启停、删除、刷新和重连 Server，并查看连接状态、Server 能力、工具、资源、Prompt 和错误。

新增 Server 时需要确认信任。MCP 是由 Extension Host 启动的外部进程，实际拥有当前操作系统账户可访问的文件、网络和环境权限。只配置可信命令，并尽量限制 Server 参数中的目录和账户权限。

## 配置文件

主配置路径：

```text
~/.evancod/mcp-servers.json
```

旧的 `~/.claude/cc-evancod/mcp-servers.json` 会被兼容读取并迁移，但不会删除原文件。

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
      "cwd": "/optional/working/directory",
      "enabled": true,
      "env": {
        "TOKEN": "${secret:TOKEN}"
      }
    }
  }
}
```

通过设置界面输入的环境变量值存入 VS Code `SecretStorage`，JSON 只保留 `${secret:变量名}` 引用。为兼容旧配置，也支持明文值和 `${ENV_VAR}` 操作系统环境变量引用。

## 工具暴露

发现的工具以独立工具注册：

```text
mcp.<server>.<tool>
```

它们会显示在“工具偏好”中，可以逐项启停，并根据 MCP `annotations` 标记读取、写入、网络和风险能力。原有 `mcp` 元工具继续保留，可执行 `call_tool`、`read_resource`、`list_tools` 和 `list_resources`。

工具配置和 Agent 配置只能收紧当前会话权限，不能自行启用 `bypassPermissions`。调用 MCP 工具仍受会话权限、capability 策略和用户确认约束。

## stdio 约束

- Server 的 stdout 只能输出 MCP 协议消息。
- 日志必须写到 stderr。
- Evancod 只继承 SDK 允许的安全环境变量，再叠加配置中明确声明的变量。
- Server 必须正确实现 MCP 初始化、能力协商和关闭生命周期。

## 故障排查

1. 在 MCP 设置页检查状态和错误。
2. 确认命令可在系统终端运行，参数和工作目录存在。
3. 点击刷新按钮重新连接并重新发现工具、资源与 Prompt。
4. 在“工具偏好”中确认对应 `mcp.<server>.<tool>` 没有被禁用。
5. Server 无响应时检查其 stderr，避免向 stdout 写日志。

互操作回归使用 SDK 自带 stdio 示例，覆盖初始化协商、工具发现、调用和关闭。
