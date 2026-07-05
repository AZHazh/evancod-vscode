/**
 * 生成图片的磁盘存储工具（ImageGenTool 与 Responses 原生生图共用）。
 *
 * 约定：
 * - 图片以 base64 传入，写入工作区（默认 output/imagegen/）。
 * - 返回相对工作区路径 + 前端预览数据（base64）。
 * - base64 不进入 LLM 上下文；持久化只保留 path。
 */

import * as path from 'path'
import * as fs from 'fs/promises'

/** 保存前的原始图片形态 */
export interface RawImage {
  base64: string
  mime: string
}

/** 单张已保存图片的信息（含 base64 前端预览） */
export interface SavedImage {
  base64: string
  mime: string
  name: string
  /** 相对工作区路径 */
  path: string
}

/** 根据 mime 推断文件扩展名 */
function extFromMime(mime: string): string {
  const normalized = mime.toLowerCase()
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg'
  if (normalized.includes('webp')) return '.webp'
  if (normalized.includes('gif')) return '.gif'
  return '.png'
}

/**
 * 计算输出文件的绝对路径列表。
 * 单张沿用 stem.ext；多张追加 -1/-2 序号。
 */
function buildOutputPaths(
  cwd: string,
  outputPath: string | undefined,
  count: number,
  fallbackExt: string
): string[] {
  const rel = outputPath && outputPath.trim() ? outputPath.trim() : `output/imagegen/image${fallbackExt}`
  const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel)

  const ext = path.extname(abs) || fallbackExt
  const dir = path.dirname(abs)
  const stem = path.basename(abs, ext)

  if (count === 1) {
    return [path.join(dir, `${stem}${ext}`)]
  }

  const paths: string[] = []
  for (let i = 1; i <= count; i++) {
    paths.push(path.join(dir, `${stem}-${i}${ext}`))
  }
  return paths
}

/**
 * 保存图片到磁盘，返回相对路径列表与前端预览数据。
 *
 * @param cwd 工作区根目录（相对路径基准）
 * @param rawImages 原始图片（base64 + mime）
 * @param outputPath 可选的自定义输出路径（相对工作区）
 */
export async function saveGeneratedImages(
  cwd: string,
  rawImages: RawImage[],
  outputPath?: string
): Promise<SavedImage[]> {
  if (rawImages.length === 0) return []

  const fallbackExt = extFromMime(rawImages[0].mime)
  const outputPaths = buildOutputPaths(cwd, outputPath, rawImages.length, fallbackExt)
  const saved: SavedImage[] = []

  for (let i = 0; i < rawImages.length; i++) {
    const { base64, mime } = rawImages[i]
    const absPath = outputPaths[i]
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, Buffer.from(base64, 'base64'))

    const relPath = path.relative(cwd, absPath)
    saved.push({ base64, mime, name: path.basename(absPath), path: relPath })
  }

  return saved
}

/**
 * 生成一个带时间戳的默认输出路径，避免多次生图互相覆盖。
 * 追加短随机串，防止同一毫秒内多张图路径冲突。
 * 例：output/imagegen/gen-1720000000000-a1b2c3.png
 */
export function timestampedImagePath(mime: string): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `output/imagegen/gen-${Date.now()}-${suffix}${extFromMime(mime)}`
}

/**
 * 读取磁盘图片并转为 base64（会话重开时读盘重显用）。
 * 读取失败返回 undefined（调用方决定降级展示）。
 */
export async function readImageAsBase64(cwd: string, relPath: string): Promise<string | undefined> {
  try {
    const abs = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath)
    const buffer = await fs.readFile(abs)
    return buffer.toString('base64')
  } catch {
    return undefined
  }
}
