// VSCode API 类型定义
interface VSCodeAPI {
  postMessage(message: any): void
  getState(): any
  setState(state: any): void
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VSCodeAPI
    vscode?: VSCodeAPI
  }
}

let vscodeApi: VSCodeAPI | null = null
let browserState: any = undefined

function createBrowserFallback(): VSCodeAPI {
  return {
    postMessage(_message: any) {
      // fallback 模式下不发消息（开发调试用，生产不输出避免高频 I/O）
    },
    getState() {
      return browserState
    },
    setState(state: any) {
      browserState = state
    },
  }
}

export function useVSCode() {
  if (!vscodeApi) {
    vscodeApi = typeof window.acquireVsCodeApi === 'function'
      ? window.acquireVsCodeApi()
      : createBrowserFallback()
    window.vscode = vscodeApi
  }

  return {
    postMessage: (message: any) => {
      vscodeApi?.postMessage(message)
    },
    getState: () => {
      return vscodeApi?.getState()
    },
    setState: (state: any) => {
      vscodeApi?.setState(state)
    },
  }
}
