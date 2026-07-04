# 快速测试计划审批功能

## 方法 1：直接在 Evancod 中测试（推荐）

### 步骤：

1. **启动扩展**
   - 按 `F5` 启动调试模式，或者重新加载扩展

2. **打开 Evancod 聊天界面**
   - 按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Windows）
   - 输入 `Evancod: Open Chat`

3. **发送以下消息触发计划模式**：

```
请帮我重构这个项目的认证系统，先制定详细计划
```

或者更直接的：

```
请先进入计划模式，然后帮我添加一个用户管理功能，包括增删改查
```

4. **等待 AI 调用 exit_plan_mode**
   - AI 会分析项目
   - 制定详细计划
   - 调用 `exit_plan_mode` 工具
   - 此时应该弹出计划审批对话框

5. **测试所有按钮**：
   - ✅ 点击"批准计划" - 应该关闭对话框并继续执行
   - ✅ 点击"拒绝计划" - 应该打开拒绝原因对话框
     - 填写原因后点击"确定" - 应该关闭所有对话框
     - 点击"取消" - 应该只关闭拒绝对话框
   - ✅ 点击右上角 ✕ - 应该关闭对话框
   - ✅ 点击对话框外的遮罩 - 应该关闭对话框

---

## 方法 2：在浏览器开发者工具中模拟（最快）

如果 AI 不配合或者速度慢，你可以直接在浏览器控制台模拟：

### 步骤：

1. **打开 Evancod 聊天界面**

2. **打开浏览器开发者工具**
   - 按 `Cmd+Option+I`（Mac）或 `F12`（Windows）
   - 或者右键页面 → 检查

3. **在 Console 中执行以下代码**：

```javascript
// 模拟一个计划提交事件
window.postMessage({
  type: 'plan.submitted',
  data: {
    plan: {
      id: 'test-plan-123',
      title: '测试计划 - 添加用户管理功能',
      description: '这是一个测试计划，用于验证计划审批功能是否正常工作',
      state: 'planning',
      tasks: [
        {
          id: 'task-1',
          subject: '创建用户模型',
          description: '定义用户数据结构和验证规则',
          estimatedTime: '30分钟',
          risks: ['可能与现有模型冲突']
        },
        {
          id: 'task-2',
          subject: '实现用户 CRUD API',
          description: '创建增删改查的 REST API 端点',
          estimatedTime: '1小时',
          risks: []
        },
        {
          id: 'task-3',
          subject: '编写测试用例',
          description: '为所有 API 编写单元测试和集成测试',
          estimatedTime: '45分钟',
          risks: []
        }
      ],
      steps: [
        '1. 分析现有项目结构，确定用户模型位置',
        '2. 创建 User.ts 文件，定义用户接口',
        '3. 实现用户验证逻辑',
        '4. 创建 API 路由文件',
        '5. 实现 GET /users 获取用户列表',
        '6. 实现 POST /users 创建用户',
        '7. 实现 PUT /users/:id 更新用户',
        '8. 实现 DELETE /users/:id 删除用户',
        '9. 编写单元测试',
        '10. 运行测试并修复问题'
      ],
      risks: [
        {
          level: 'high',
          description: 'fuxi-im 是纯 TypeScript SDK 库，没有任何 webview、UI 界面或 HTML 文件。在此项目中添加 webview 意味着需要引入一个完整的前端 UI 层，这会大幅改变项目的定位和结构。',
          mitigation: '确认用户是否确实要在这个 SDK 项目中添加 UI，还是他们指的是另一个使用此 SDK 的前端项目。'
        },
        {
          level: 'medium',
          description: '可能与现有代码结构冲突',
          mitigation: '先备份现有文件，创建新分支进行开发'
        },
        {
          level: 'low',
          description: '测试覆盖率可能不够',
          mitigation: '确保至少达到 80% 的代码覆盖率'
        }
      ],
      createdAt: new Date().toISOString()
    }
  }
}, '*');
```

4. **测试按钮功能**
   - 应该立即弹出计划审批对话框
   - 测试所有按钮是否正常工作

---

## 方法 3：修改代码添加测试按钮（用于反复测试）

如果需要反复测试，可以临时添加一个测试按钮：

### 在 `webview/src/views/ChatView.vue` 中添加：

```vue
<template>
  <div class="chat-view">
    <!-- 添加测试按钮 -->
    <button 
      @click="testPlanApproval" 
      style="position: fixed; top: 10px; right: 10px; z-index: 9999; padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;"
    >
      测试计划审批
    </button>
    
    <!-- 其他组件... -->
  </div>
</template>

<script setup lang="ts">
// ... 现有代码 ...

// 添加测试函数
function testPlanApproval() {
  planStore.setPlan({
    id: 'test-plan-' + Date.now(),
    title: '测试计划 - 添加用户管理功能',
    description: '这是一个测试计划，用于验证计划审批功能是否正常工作',
    state: 'planning',
    tasks: [
      {
        id: 'task-1',
        subject: '创建用户模型',
        description: '定义用户数据结构和验证规则',
        estimatedTime: '30分钟',
        risks: ['可能与现有模型冲突']
      },
      {
        id: 'task-2',
        subject: '实现用户 CRUD API',
        description: '创建增删改查的 REST API 端点',
        estimatedTime: '1小时'
      }
    ],
    steps: [
      '1. 分析现有项目结构',
      '2. 创建 User.ts 文件',
      '3. 实现 API 路由',
      '4. 编写测试用例'
    ],
    risks: [
      {
        level: 'high',
        description: '这是一个高风险项',
        mitigation: '请仔细审阅代码'
      },
      {
        level: 'medium',
        description: '这是一个中等风险项',
        mitigation: '先备份现有文件'
      }
    ],
    createdAt: new Date().toISOString()
  })
}
</script>
```

添加后，点击页面右上角的"测试计划审批"按钮即可快速测试。

---

## 预期结果

### ✅ 正常工作的表现：

1. **点击"批准计划"**：
   - 对话框关闭
   - 控制台输出：`plan.approve` 消息
   - planStore.currentPlan.state 变为 'approved'

2. **点击"拒绝计划"**：
   - 打开拒绝原因对话框
   - 填写原因后点击"确定"
   - 所有对话框关闭
   - 控制台输出：`plan.reject` 消息和原因
   - planStore.currentPlan.state 变为 'rejected'

3. **点击"取消"或关闭按钮**：
   - 对话框关闭
   - 没有发送任何消息

### ❌ 修复前的问题（不应再出现）：

- ❌ 点击按钮没有任何反应
- ❌ 对话框无法关闭
- ❌ 点击确定/取消/关闭都不起作用

---

## 调试技巧

### 查看控制台日志：

在开发者工具的 Console 中，你应该能看到：

```javascript
// 批准时
{type: 'plan.approve', data: {planId: 'xxx'}}

// 拒绝时
{type: 'plan.reject', data: {planId: 'xxx', reason: '用户填写的原因'}}
```

### 检查 planStore 状态：

在 Console 中执行：

```javascript
// 查看当前计划
window.__PLAN_STORE__ = usePlanStore()
console.log(window.__PLAN_STORE__.currentPlan)
console.log(window.__PLAN_STORE__.showApprovalDialog)
```

---

## 需要检查的文件

如果测试失败，检查以下文件是否正确修改：

1. ✅ `webview/src/views/ChatView.vue` - 事件监听和计算属性
2. ✅ `webview/src/components/plan/PlanApproval.vue` - 关闭处理
3. ✅ `webview/src/stores/plan.ts` - approvePlan 和 rejectPlan 方法
4. ✅ `src/services/webview/WebviewManager.ts` - handlePlanApprove 和 handlePlanReject
5. ✅ `src/services/plan/PlanModeManager.ts` - approvePlan 和 rejectPlan 方法

如果还有问题，告诉我具体的错误信息或现象！
