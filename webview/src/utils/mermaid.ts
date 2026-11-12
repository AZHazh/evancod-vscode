let nextDiagramId = 0
let renderQueue: Promise<unknown> = Promise.resolve()

/** marked 会为未闭合的围栏生成 code token；流式期间只渲染已经闭合的图。 */
export function isClosedMermaidFence(raw: string): boolean {
  const lines = raw.trimEnd().split('\n')
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] || '')?.[1]
  if (!opening || lines.length < 2) return false
  return new RegExp(`^ {0,3}${opening[0]}{${opening.length},}\\s*$`).test(lines[lines.length - 1])
}

/** Mermaid 的配置是全局状态，按顺序渲染，避免不同消息/主题互相覆盖。 */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    const textColor = dark ? '#55b7ff' : '#006ab1'
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: dark ? 'dark' : 'default',
      themeVariables: {
        textColor,
        primaryTextColor: textColor,
        secondaryTextColor: textColor,
        tertiaryTextColor: textColor,
      },
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      maxTextSize: 100_000,
      maxEdges: 500,
      secure: ['securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels'],
      fontFamily: 'system-ui, sans-serif',
    })
    const { svg } = await mermaid.render(`evancod-mermaid-${++nextDiagramId}`, source)
    // 将文字颜色保存在 SVG 内，预览和 PNG 导出使用相同样式。
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    for (const label of root.querySelectorAll<SVGElement | HTMLElement>('text, tspan, foreignObject *')) {
      label.style.setProperty('fill', textColor, 'important')
      label.style.setProperty('color', textColor, 'important')
    }
    return new XMLSerializer().serializeToString(root)
  })
  renderQueue = result.catch(() => undefined)
  return result
}

export function diagramSize(svg: string): { width: number; height: number } {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const width = box?.[2] || parseFloat(root.getAttribute('width') || '') || 800
  const height = box?.[3] || parseFloat(root.getAttribute('height') || '') || 450
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('流程图尺寸无效')
  }
  return { width, height }
}

/** SVG 使用 data URI，兼容 Webview 现有 CSP，无需开放 blob 或外部图片来源。 */
export async function diagramToPng(svg: string, dark: boolean): Promise<string> {
  const { width, height } = diagramSize(svg)
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)))
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.style.maxWidth = 'none'
  const source = new XMLSerializer().serializeToString(root)
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('无法将流程图转换为图片'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境不支持 PNG 导出')
  context.fillStyle = dark ? '#1e1e1e' : '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png').split(',')[1]
}
