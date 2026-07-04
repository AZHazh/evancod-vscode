# new-api 同步功能修复方案

## 问题诊断

1. ✅ new-api 服务器已实现 `/api/desktop-sync/*` 端点
2. ❌ VSCode 插件代码调用了错误的 `/api/token` 端点
3. ❌ 架构不匹配：从 Electron（有本地服务器）移植到 VSCode（无本地服务器）

## 修复方案：使用轮询 + 浏览器授权

### 流程设计

```
1. 用户点击「同步」
   ↓
2. VSCode 插件生成随机 state
   ↓
3. 打开浏览器访问 new-api 授权页
   └→ https://www.tiandouai.com/desktop-sync?state=xxx&mode=polling
   ↓
4. 用户在浏览器中登录并授权
   ↓
5. new-api 前端调用 /api/desktop-sync/issue 获取 code
   ↓
6. new-api 前端将 code 存储到服务端（新增端点）
   └→ POST /api/desktop-sync/sessions
       { "state": "xxx", "code": "yyy" }
   ↓
7. VSCode 插件轮询检查状态（每 2 秒）
   └→ GET /api/desktop-sync/sessions/{state}
   ↓
8. 收到 code 后，调用 exchange
   └→ POST /api/desktop-sync/exchange { "code": "xxx" }
   ↓
9. 获取 Token 列表，展示预览
```

### 需要修改的文件

#### 1. new-api 后端（新增 2 个端点）

**文件**: `controller/desktop_sync.go`

```go
// 会话存储（用于轮询）
var desktopSyncSessions = struct {
	sync.RWMutex
	items map[string]desktopSyncSession
}{
	items: make(map[string]desktopSyncSession),
}

type desktopSyncSession struct {
	State     string    `json:"state"`
	Code      string    `json:"code"`
	Status    string    `json:"status"` // "pending", "authorized", "consumed"
	CreatedAt time.Time `json:"created_at"`
}

// POST /api/desktop-sync/sessions
// 浏览器授权完成后，前端调用此接口存储 code
func StoreDesktopSyncSession(c *gin.Context) {
	var req struct {
		State string `json:"state" binding:"required"`
		Code  string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	desktopSyncSessions.Lock()
	defer desktopSyncSessions.Unlock()
	
	// 清理过期会话（超过 10 分钟）
	now := time.Now()
	for state, session := range desktopSyncSessions.items {
		if now.Sub(session.CreatedAt) > 10*time.Minute {
			delete(desktopSyncSessions.items, state)
		}
	}
	
	desktopSyncSessions.items[req.State] = desktopSyncSession{
		State:     req.State,
		Code:      req.Code,
		Status:    "authorized",
		CreatedAt: now,
	}
	
	common.ApiSuccess(c, gin.H{"status": "ok"})
}

// GET /api/desktop-sync/sessions/:state
// VSCode 插件轮询此接口检查授权状态
func GetDesktopSyncSession(c *gin.Context) {
	state := c.Param("state")
	if state == "" {
		common.ApiErrorMsg(c, "state required")
		return
	}

	desktopSyncSessions.RLock()
	session, exists := desktopSyncSessions.items[state]
	desktopSyncSessions.RUnlock()

	if !exists {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"status": "pending",
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"status": session.Status,
			"code":   session.Code,
		},
	})
}
```

**文件**: `router/api-router.go`

```go
// 在 desktopSyncRoute 中添加：
desktopSyncRoute.POST("/sessions", controller.StoreDesktopSyncSession)
desktopSyncRoute.GET("/sessions/:state", controller.GetDesktopSyncSession)
```

#### 2. new-api 前端授权页

**文件**: `web/default/src/routes/_authenticated/desktop-sync.tsx`

修改授权成功后的逻辑：

```typescript
// 授权成功后
const handleAuthorize = async () => {
  try {
    // 1. 调用 issue 获取 code
    const issueRes = await fetch('/api/desktop-sync/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const { code } = await issueRes.json()
    
    // 2. 如果是轮询模式，存储到服务端
    if (mode === 'polling') {
      await fetch('/api/desktop-sync/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, code })
      })
      
      // 显示成功页面
      setStatus('success')
      setMessage('授权成功！请返回 VSCode 继续操作。')
    } else {
      // 传统回调模式（给 cc-desktop 用）
      const redirectUrl = `${redirectUri}?code=${code}&state=${state}`
      window.location.href = redirectUrl
    }
  } catch (error) {
    setStatus('error')
    setMessage('授权失败：' + error.message)
  }
}
```

#### 3. VSCode 插件代码

**文件**: `src/services/newapi/NewApiSyncService.ts`

完全重写：

```typescript
/**
 * new-api 同步服务（轮询版本）
 * 适配 VSCode Extension 环境（无本地 HTTP 服务器）
 */

import { randomBytes } from 'crypto'
import axios, { type AxiosInstance } from 'axios'

export interface NewApiToken {
  id: number
  name: string
  key: string
  group: string
  status: number
  unlimited_quota: boolean
  remain_quota: number
  expired_time: number
  models?: string[]
}

export interface SyncConfig {
  siteUrl: string
}

export interface SyncSession {
  state: string
  authorizeUrl: string
  status: 'pending' | 'authorized' | 'completed' | 'timeout' | 'error'
  error?: string
}

export class NewApiSyncService {
  private client: AxiosInstance
  private siteUrl: string

  constructor(config: SyncConfig) {
    this.siteUrl = config.siteUrl.replace(/\/+$/, '') // 移除尾部斜杠
    this.client = axios.create({
      baseURL: this.siteUrl,
      timeout: 30000,
    })
  }

  /**
   * 开始同步流程
   * 返回授权 URL，前端需要打开浏览器
   */
  startSync(): SyncSession {
    const state = this.generateState()
    const authorizeUrl = `${this.siteUrl}/desktop-sync?state=${encodeURIComponent(state)}&mode=polling`
    
    return {
      state,
      authorizeUrl,
      status: 'pending',
    }
  }

  /**
   * 轮询检查授权状态
   * 
   * @param state - 会话 state
   * @param onProgress - 进度回调
   * @returns Promise<string> - 授权成功后返回 code
   */
  async pollAuthorization(
    state: string,
    onProgress?: (message: string) => void
  ): Promise<string> {
    const maxAttempts = 150 // 5 分钟（2 秒 * 150）
    const pollInterval = 2000 // 2 秒
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(`/api/desktop-sync/sessions/${state}`)
        
        if (!response.data.success) {
          throw new Error('查询授权状态失败')
        }
        
        const { status, code } = response.data.data
        
        if (status === 'authorized' && code) {
          onProgress?.('授权成功，正在获取数据...')
          return code
        }
        
        // 仍在等待
        const remaining = Math.ceil((maxAttempts - attempt) * pollInterval / 1000)
        onProgress?.(`等待用户授权... (${remaining}秒后超时)`)
        
        await this.sleep(pollInterval)
      } catch (error) {
        if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
          throw new Error('无法连接到 new-api 服务器')
        }
        // 继续轮询（网络抖动）
        await this.sleep(pollInterval)
      }
    }
    
    throw new Error('授权超时，请重试')
  }

  /**
   * 用 code 交换 Token 列表
   */
  async exchangeCode(code: string): Promise<{
    tokens: NewApiToken[]
    availableModels: string[]
    groupModels: Record<string, string[]>
  }> {
    const response = await this.client.post('/api/desktop-sync/exchange', { code })
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'exchange 失败')
    }
    
    const { tokens, available_models, group_models } = response.data.data
    
    return {
      tokens: tokens || [],
      availableModels: available_models || [],
      groupModels: group_models || {},
    }
  }

  /**
   * 完整的同步流程
   */
  async sync(onProgress?: (message: string) => void): Promise<{
    tokens: NewApiToken[]
    availableModels: string[]
    groupModels: Record<string, string[]>
  }> {
    // 1. 开始同步，返回授权 URL
    const session = this.startSync()
    onProgress?.(`请在浏览器中完成授权\n${session.authorizeUrl}`)
    
    // 2. 轮询等待授权
    const code = await this.pollAuthorization(session.state, onProgress)
    
    // 3. 用 code 交换数据
    const result = await this.exchangeCode(code)
    onProgress?.(`成功获取 ${result.tokens.length} 个 Token`)
    
    return result
  }

  private generateState(): string {
    return randomBytes(24).toString('base64url')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
```

**文件**: `src/services/newapi/NewApiMessageHandler.ts`

修改为使用新的轮询方式：

```typescript
async function handleSyncStart(
  data: { siteUrl: string },
  webview: vscode.Webview
) {
  try {
    // 创建同步服务
    const syncService = new NewApiSyncService({ siteUrl: data.siteUrl })
    
    // 开始同步流程（返回授权 URL）
    const session = syncService.startSync()
    
    // 打开浏览器
    await vscode.env.openExternal(vscode.Uri.parse(session.authorizeUrl))
    
    // 显示进度通知
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'new-api 同步',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: '等待浏览器授权...' })
        
        // 轮询授权状态
        const result = await syncService.sync((message) => {
          progress.report({ message })
        })
        
        // 发送预览数据到 Webview
        webview.postMessage({
          type: 'newapi.sync.preview',
          data: {
            tokens: result.tokens,
            models: result.availableModels,
            groupModels: result.groupModels,
          },
        })
      }
    )
  } catch (error) {
    webview.postMessage({
      type: 'error',
      data: {
        message: error instanceof Error ? error.message : '同步失败',
        code: 'NEWAPI_SYNC_ERROR',
      },
    })
  }
}
```

## 部署步骤

1. **修改 new-api 后端**
   ```bash
   cd /Users/mr_an/Documents/new-api-main
   # 编辑 controller/desktop_sync.go 和 router/api-router.go
   # 重新编译部署
   ```

2. **修改 new-api 前端**
   ```bash
   cd /Users/mr_an/Documents/new-api-main/web/default
   # 编辑 src/routes/_authenticated/desktop-sync.tsx
   npm run build
   ```

3. **修改 VSCode 插件**
   ```bash
   cd /Users/mr_an/Documents/vscode-evancod
   # 替换 NewApiSyncService.ts 和 NewApiMessageHandler.ts
   npm run compile
   ```

4. **测试**
   - 启动 VSCode 插件调试
   - 点击「同步」按钮
   - 在浏览器中完成授权
   - 返回 VSCode 查看同步结果

## 注意事项

- 轮询间隔设置为 2 秒，避免频繁请求
- 超时时间设置为 5 分钟
- 会话数据在服务端内存中保存 10 分钟后自动清理
- 支持取消同步操作
