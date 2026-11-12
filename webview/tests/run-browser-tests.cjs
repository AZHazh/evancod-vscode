// 使用本机 Chromium 和 CDP，直接测试真实 Vue 组件、SVG 和 Canvas，无浏览器测试依赖。
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')

async function main() {
  const candidates = [process.env.BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)
  let executable
  for (const candidate of candidates) {
    try { await fs.access(candidate); executable = candidate; break } catch { /* 下一个路径 */ }
  }
  if (!executable) throw new Error('请通过 BROWSER_PATH 指定 Chromium 浏览器')
  const { build } = await import('vite')
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'evancod-diagram-build-'))
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (pathname === '/panel.html') {
        // 模拟宿主：文档位置与扩展资源目录不同，脚本使用绝对资源 URI。
        const html = await fs.readFile(path.join(output, 'tests/diagram-preview.html'), 'utf8')
        response.setHeader('Content-Type', 'text/html')
        response.end(html.replace(/(src|href)="([^"]+)"/g, (_match, attribute, value) =>
          `${attribute}="${new URL(value, 'http://localhost/extension/webview/dist/tests/diagram-preview.html').pathname}"`))
        return
      }
      if (!pathname.startsWith('/extension/webview/dist/')) throw new Error('unknown resource')
      const target = path.resolve(output, pathname.slice('/extension/webview/dist/'.length))
      if (!target.startsWith(`${path.resolve(output)}${path.sep}`)) throw new Error('invalid resource')
      response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'application/octet-stream')
      response.end(await fs.readFile(target))
    } catch {
      response.statusCode = 404
      response.end()
    }
  })
  let browser
  let socket
  let profile
  try {
    await build({
      root: path.resolve(__dirname, '..'),
      build: { outDir: output, emptyOutDir: true, rollupOptions: { input: path.join(__dirname, 'diagram-preview.html') } },
      logLevel: 'error',
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const origin = `http://127.0.0.1:${address.port}`
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'evancod-diagram-test-'))
    browser = spawn(executable, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' })
    browser.on('error', error => { throw error })
    const until = async (operation, description) => {
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        const value = await operation()
        if (value) return value
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`超时：${description}`)
    }
    const port = await until(async () => {
      try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0] } catch { return null }
    }, '启动浏览器')
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let sequence = 0
    const pending = new Map()
    const browserErrors = []
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const call = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) call.reject(new Error(message.error.message))
        else call.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') {
        browserErrors.push(message.params.exceptionDetails.text)
      }
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    }
    await call('Runtime.enable')
    await call('Page.navigate', { url: `${origin}/panel.html` })
    await until(() => evaluate('Boolean(document.querySelector(".mermaid-diagram .diagram-status"))'), '流程图生成提示')
    assert.match(await evaluate('document.querySelector(".mermaid-diagram .diagram-status").textContent'), /正在生成流程图/)
    assert.equal(await evaluate('document.querySelectorAll(".mermaid-diagram pre, .mermaid-diagram details").length'), 0)
    assert.equal(await evaluate('document.querySelectorAll(".diagram-svg svg").length'), 0)
    const source = 'flowchart TD\n subgraph 流程\n A[开始] -->|继续| B[完成]\n end'
    const markdown = `\`\`\`mermaid\n${source}\n\`\`\``
    const update = (content, streaming = false) => evaluate(`window.diagramHarness.update(${JSON.stringify(content)}, ${streaming})`)
    await update(markdown, true)
    await until(() => evaluate('Boolean(document.querySelector(".diagram-svg svg"))'), '流程图渲染')
    assert.match(await evaluate('document.querySelector(".diagram-svg").textContent'), /开始/)
    assert.equal(await evaluate('document.querySelectorAll(".mermaid-diagram pre, .mermaid-diagram details").length'), 0)
    const labelColors = () => evaluate('[...document.querySelectorAll(".diagram-svg svg text, .diagram-svg svg tspan")].map(label => getComputedStyle(label).fill)')
    const darkColors = await labelColors()
    assert.ok(darkColors.length >= 4)
    assert.ok(darkColors.every(color => color === 'rgb(85, 183, 255)'))
    await evaluate('document.querySelector("button[title=复制为代码]").click()')
    await until(() => evaluate('window.diagramHarness.copied'), '复制代码')
    assert.equal(await evaluate('window.diagramHarness.copied'), source)
    await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.includes("下载 PNG")).click()')
    await until(() => evaluate('window.diagramHarness.posted.length'), 'PNG 导出')
    const saved = await evaluate('window.diagramHarness.posted[0]')
    assert.equal(saved.type, 'image.save')
    assert.equal(Buffer.from(saved.data.base64, 'base64').subarray(1, 4).toString(), 'PNG')
    // 检查独立 PNG 的实际像素，确保导出也包含蓝色文字。
    assert.ok(await evaluate(`(async () => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + window.diagramHarness.posted[0].data.base64
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let bluePixels = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.abs(pixels[i] - 85) < 12 && Math.abs(pixels[i + 1] - 183) < 12 && pixels[i + 2] > 240) bluePixels++
      }
      return bluePixels > 20
    })()`))
    await evaluate('document.querySelector("button[title=放大预览]").click()')
    await until(() => evaluate('Boolean(document.querySelector("[role=dialog]"))'), '放大预览')
    assert.equal(await evaluate('[...document.querySelectorAll(".diagram-preview-svg text")].every(label => getComputedStyle(label).fill === "rgb(85, 183, 255)")'), true)
    await update(`${markdown}\n\n后续输出`, true)
    await until(() => evaluate('document.body.textContent.includes("后续输出")'), '流式更新')
    assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'), 1)
    await evaluate('document.querySelector("button[title=放大]").click()')
    await evaluate('document.querySelector("[role=dialog] button").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await until(() => evaluate('!document.querySelector("[role=dialog]")'), 'Escape 关闭')
    await update(`${markdown}\n\n${markdown}`)
    await until(() => evaluate('document.querySelectorAll(".diagram-svg svg").length === 2'), '多图渲染')
    const ids = await evaluate('[...document.querySelectorAll(".diagram-svg > svg")].map(svg => svg.id)')
    assert.equal(new Set(ids).size, 2)
    await evaluate('document.body.className = "vscode-light"')
    await until(async () => {
      const colors = await labelColors()
      return colors.length >= 8 && colors.every(color => color === 'rgb(0, 106, 177)')
    }, '浅色主题蓝色文字')
    await update('```mermaid\ninvalid diagram\n```')
    await until(() => evaluate('Boolean(document.querySelector(".diagram-error"))'), '语法错误回退')
    assert.equal(await evaluate('document.querySelectorAll(".mermaid-diagram pre, .mermaid-diagram details").length'), 0)
    await update('<img src=x onerror="window.injected=true">\n\n' + markdown)
    await until(() => evaluate('Boolean(document.querySelector(".diagram-svg svg"))'), '安全渲染')
    assert.equal(await evaluate('window.injected === true'), false,
      await evaluate('document.querySelector(".markdown-content").innerHTML.slice(0, 300)'))
    assert.deepEqual(browserErrors, [])
    console.log('PASS：流式生成不展示源码、深浅主题蓝色文字、SVG 渲染、复制代码、蓝字 PNG 导出、放大预览、更新保留、多图隔离、错误提示与安全渲染')
  } finally {
    socket?.close()
    if (browser && browser.exitCode === null) {
      const exited = new Promise(resolve => browser.once('exit', resolve))
      browser.kill()
      await exited
    }
    if (server.listening) await new Promise(resolve => server.close(resolve))
    if (profile) {
      assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
      assert.ok(path.basename(profile).startsWith('evancod-diagram-test-'))
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(output).startsWith('evancod-diagram-build-'))
    await fs.rm(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
