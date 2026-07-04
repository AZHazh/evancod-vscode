# new-api 同步功能修复 - 部署指南

## 📋 问题总结

**根本原因**：
1. ✅ new-api 服务端已实现基础的 `desktop-sync` OAuth 端点
2. ❌ 缺少轮询支持端点（VSCode 插件无法启动本地 HTTP 服务器）
3. ❌ VSCode 插件代码调用了错误的 `/api/token` 端点

**解决方案**：
采用**轮询方案**，用户在浏览器授权后，VSCode 插件轮询检查授权状态。

---

## ✅ 已完成的修改

### 1. VSCode 插件代码（已更新）

- ✅ `src/services/newapi/NewApiSyncService.ts` - 重写为轮询版本
- ✅ `src/services/newapi/NewApiMessageHandler.ts` - 使用新的轮询流程

### 2. new-api 后端代码（已更新）

- ✅ `controller/desktop_sync.go` - 新增 2 个轮询端点：
  - `StoreDesktopSyncSession` - 存储授权会话
  - `GetDesktopSyncSession` - 查询授权状态
  
- ✅ `router/api-router.go` - 注册新端点：
  - `POST /api/desktop-sync/sessions`
  - `GET /api/desktop-sync/sessions/:state`

### 3. new-api 前端代码（已更新）

- ✅ `web/default/src/routes/_authenticated/desktop-sync.tsx` - 支持轮询模式
  - 新增 `mode` 参数（`callback` | `polling`）
  - 授权成功后显示成功页面（轮询模式）
  - 存储 code 到服务端供 VSCode 轮询

---

## 🚀 部署步骤

### Step 1: 重新编译 new-api

```bash
cd /Users/mr_an/Documents/new-api-main

# 1. 编译后端（Go）
go build -o new-api

# 2. 编译前端
cd web/default
npm install  # 如果还没安装依赖
npm run build

# 3. 回到根目录
cd ../..
```

### Step 2: 重启 new-api 服务

```bash
# 如果是 Docker 部署
docker-compose down
docker-compose up -d --build

# 如果是直接运行
# 停止旧进程
pkill new-api

# 启动新版本
./new-api
```

### Step 3: 验证 new-api 端点

```bash
# 测试轮询端点是否可用
curl -X GET "https://www.tiandouai.com/api/desktop-sync/sessions/test-state"

# 预期返回（会话不存在，返回 pending）：
# {"success":true,"data":{"status":"pending"}}
```

### Step 4: 编译 VSCode 插件

```bash
cd /Users/mr_an/Documents/vscode-evancod

# 安装依赖（如果还没安装）
npm install

# 编译插件
npm run compile

# 编译 Webview
cd webview
npm install
npm run build
cd ..
```

### Step 5: 测试同步功能

1. **启动 VSCode 插件调试**
   - 按 `F5` 或点击「Run and Debug」
   - 选择「Run Extension」

2. **打开同步面板**
   - 在调试的 VSCode 窗口中
   - 执行命令：`Evancod: Sync new-api`
   - 或点击界面上的「同步」按钮

3. **输入配置**
   - 站点 URL: `https://www.tiandouai.com`
   - 点击「测试连接」

4. **浏览器授权**
   - 系统会自动打开浏览器
   - 访问 `https://www.tiandouai.com/desktop-sync?state=xxx&mode=polling`
   - 如果未登录，先登录
   - 点击「授权」按钮

5. **等待同步**
   - 浏览器显示「授权成功！请返回 VSCode 继续操作」
   - VSCode 会自动获取 Token 列表
   - 选择要导入的 Token
   - 配置模型映射
   - 确认导入

---

## 🔍 故障排查

### 问题 1: 浏览器显示「Invalid desktop sync redirect URI」

**原因**：前端代码未正确处理轮询模式

**解决**：
```bash
# 检查前端是否正确编译
cd /Users/mr_an/Documents/new-api-main/web/default
npm run build

# 重启 new-api 服务
```

### 问题 2: VSCode 显示「授权超时（5分钟）」

**原因**：
1. 浏览器未完成授权
2. new-api 后端未收到授权请求
3. 网络问题

**解决**：
```bash
# 1. 检查 new-api 日志
docker logs <container-name>

# 2. 手动测试存储端点
curl -X POST "https://www.tiandouai.com/api/desktop-sync/sessions" \
  -H "Content-Type: application/json" \
  -d '{"state":"test-123","code":"test-code"}'

# 3. 测试查询端点
curl -X GET "https://www.tiandouai.com/api/desktop-sync/sessions/test-123"
# 应该返回：{"success":true,"data":{"status":"authorized","code":"test-code"}}
```

### 问题 3: 端点返回 404

**原因**：路由未注册或 new-api 未重启

**解决**：
```bash
# 1. 检查路由文件是否正确修改
grep -A 5 "desktopSyncRoute :=" /Users/mr_an/Documents/new-api-main/router/api-router.go

# 应该看到：
# desktopSyncRoute.POST("/sessions", controller.StoreDesktopSyncSession)
# desktopSyncRoute.GET("/sessions/:state", controller.GetDesktopSyncSession)

# 2. 重新编译并重启
go build -o new-api
./new-api
```

### 问题 4: Exchange 失败「授权码无效或已过期」

**原因**：code 已被消费或过期（5 分钟 TTL）

**解决**：重新执行授权流程

---

## 📊 完整流程图

```
┌─────────────┐
│ 1. VSCode   │
│ 点击「同步」 │
└──────┬──────┘
       │
       ↓
┌─────────────────────────────┐
│ 2. 生成 state                │
│ 打开浏览器                    │
│ URL: /desktop-sync?          │
│   state=xxx&mode=polling     │
└──────┬──────────────────────┘
       │
       ↓
┌─────────────────────────────┐
│ 3. 浏览器                    │
│ - 用户登录（如需）            │
│ - 点击「授权」                │
└──────┬──────────────────────┘
       │
       ↓
┌─────────────────────────────┐
│ 4. new-api 前端               │
│ - 调用 POST /issue           │
│ - 获取 code                  │
│ - 调用 POST /sessions        │
│   存储 {state, code}         │
│ - 显示成功页面               │
└──────┬──────────────────────┘
       │
       ↓
┌─────────────────────────────┐
│ 5. VSCode 轮询（每 2 秒）     │
│ GET /sessions/:state         │
│ 等待 status=authorized       │
└──────┬──────────────────────┘
       │
       ↓
┌─────────────────────────────┐
│ 6. 获取到 code               │
│ POST /exchange {code}        │
│ 获取 Token 列表              │
└──────┬──────────────────────┘
       │
       ↓
┌─────────────────────────────┐
│ 7. 展示预览                  │
│ 用户选择 + 配置              │
└──────┬──────────────────────┘
       │
       ↓
┌─────────────────────────────┐
│ 8. 批量创建 Provider          │
│ 完成！                       │
└─────────────────────────────┘
```

---

## 📝 API 端点说明

### 1. `POST /api/desktop-sync/issue`
- **权限**：需要登录（`UserAuth()`）
- **作用**：签发一次性 code（5 分钟有效）
- **请求体**：`{ "redirect_uri": "http://localhost:xxx/callback" }` (轮询模式可为空)
- **响应**：`{ "success": true, "data": { "code": "xxx", "expires_in": 300 } }`

### 2. `POST /api/desktop-sync/sessions`
- **权限**：无需登录
- **作用**：存储授权会话（浏览器前端调用）
- **请求体**：`{ "state": "xxx", "code": "yyy" }`
- **响应**：`{ "success": true, "data": { "status": "ok" } }`

### 3. `GET /api/desktop-sync/sessions/:state`
- **权限**：无需登录
- **作用**：查询授权状态（VSCode 轮询）
- **响应**：
  - 未授权：`{ "success": true, "data": { "status": "pending" } }`
  - 已授权：`{ "success": true, "data": { "status": "authorized", "code": "xxx" } }`

### 4. `POST /api/desktop-sync/exchange`
- **权限**：无需登录（靠 code 鉴权）
- **作用**：用 code 换取 Token 列表
- **请求体**：`{ "code": "xxx" }`
- **响应**：见 `newapi-sync-plan.md` 契约 3.3

---

## 🎯 下一步

1. **生产部署**：将更新后的 new-api 部署到 `https://www.tiandouai.com`
2. **发布插件**：将 VSCode 插件打包为 `.vsix` 文件
3. **用户文档**：编写用户使用指南

---

## ⚠️ 注意事项

1. **会话过期**：授权会话在服务端内存中保存 10 分钟后自动清理
2. **Code 过期**：一次性 code 有效期 5 分钟，使用后立即失效
3. **轮询频率**：VSCode 插件每 2 秒轮询一次，避免过于频繁
4. **取消支持**：用户可以在 VSCode 通知中取消同步操作
5. **去重机制**：按 `baseUrl + apiKey` 去重，避免重复导入

---

## 📞 支持

如果遇到问题：
1. 查看 VSCode Debug Console 日志
2. 查看 new-api 服务器日志
3. 使用 curl 手动测试各个端点
4. 参考 `NEWAPI_SYNC_FIX.md` 文档
