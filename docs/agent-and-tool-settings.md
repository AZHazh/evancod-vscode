# 自定义 Agent 与工具偏好

## 设置入口

聊天顶部“设置”包含服务商、工具偏好、创建 Agent、Agent 管理和 MCP Server。

也可以输入以下命令打开 Agent 创建向导，命令文本不会发送给模型：

```text
/create-agent
/create agent
/creat agent
```

## Agent 配置

全局定义位于 `~/.evancod/agents/<id>/`，工作区定义位于 `<workspace>/.evancod/agents/<id>/`。每个定义包含：

```text
agent.json
system.md
```

加载顺序是内置、全局、工作区，同 ID 的工作区定义覆盖全局定义。删除工作区覆盖后会恢复全局定义。文件会经过 Schema、ID 和路径安全校验；损坏文件不会被执行。

自定义 Agent 可以选择文件写入、命令和网络工具，但有效权限始终取以下各层的交集：

```text
系统权限 ∩ 会话权限 ∩ Agent 限制 ∩ 工具 capability ∩ 用户批准
```

Agent 定义不接受 `bypassPermissions`。即使定义选择 `acceptEdits`，也不能高于主会话的权限模式。

## 工具偏好

工具偏好使用 VS Code `globalState` 和 `workspaceState` 持久化。工作区显式设置覆盖全局设置，未提及项继续继承。

保存的是相对上层配置的差异，因此升级后新增工具仍按注册表默认值启用，不会因为旧白名单而被静默关闭。配置损坏时保留原存储值，运行时回退到默认启用工具并显示警告。

偏好在下一次创建 QueryEngine 时生效；已经运行的请求继续使用其创建时的不可变工具快照。
