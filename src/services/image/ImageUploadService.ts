/**
 * 图片上传处理服务
 *
 * 职责：
 * 1. 处理图片文件选择
 * 2. 图片格式验证
 * 3. 图片大小限制
 * 4. 转换为 Base64
 * 5. 与消息集成
 *
 * 支持的格式：
 * - PNG
 * - JPEG/JPG
 * - WebP
 * - GIF
 *
 * 限制：
 * - 最大文件大小：5MB
 * - 最大尺寸：4096x4096
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 图片信息
 */
export interface ImageInfo {
  /**
   * 文件名
   */
  name: string

  /**
   * MIME 类型
   */
  mimeType: string

  /**
   * Base64 编码数据
   */
  data: string

  /**
   * 文件大小（字节）
   */
  size: number

  /**
   * 原始路径（可选）
   */
  path?: string
}

/**
 * 图片上传配置
 */
interface ImageUploadConfig {
  /**
   * 最大文件大小（字节）
   * 默认：5MB
   */
  maxFileSize?: number

  /**
   * 支持的格式
   * 默认：['png', 'jpg', 'jpeg', 'webp', 'gif']
   */
  supportedFormats?: string[]
}

/**
 * 图片上传服务
 */
export class ImageUploadService {
  /**
   * 配置
   */
  private config: Required<ImageUploadConfig>

  /**
   * 构造函数
   *
   * @param config - 上传配置
   */
  constructor(config?: ImageUploadConfig) {
    this.config = {
      maxFileSize: config?.maxFileSize || 5 * 1024 * 1024, // 5MB
      supportedFormats: config?.supportedFormats || ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    }
  }

  /**
   * 选择并上传图片
   *
   * @returns Promise<ImageInfo | null> 图片信息
   */
  async selectAndUpload(): Promise<ImageInfo | null> {
    // 打开文件选择对话框
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: '选择图片',
      filters: {
        '图片文件': this.config.supportedFormats,
      },
    })

    if (!uris || uris.length === 0) {
      return null
    }

    const uri = uris[0]

    // 处理图片
    return await this.uploadFromPath(uri.fsPath)
  }

  /**
   * 从文件路径上传图片
   *
   * @param filePath - 文件路径
   * @returns Promise<ImageInfo> 图片信息
   */
  async uploadFromPath(filePath: string): Promise<ImageInfo> {
    // 1. 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在')
    }

    // 2. 获取文件信息
    const stats = fs.statSync(filePath)
    const fileName = path.basename(filePath)
    const ext = path.extname(filePath).toLowerCase().substring(1)

    // 3. 验证格式
    if (!this.config.supportedFormats.includes(ext)) {
      throw new Error(
        `不支持的图片格式: ${ext}。支持的格式: ${this.config.supportedFormats.join(', ')}`
      )
    }

    // 4. 验证大小
    if (stats.size > this.config.maxFileSize) {
      const maxMB = (this.config.maxFileSize / (1024 * 1024)).toFixed(1)
      const fileMB = (stats.size / (1024 * 1024)).toFixed(1)
      throw new Error(`文件过大: ${fileMB}MB。最大支持: ${maxMB}MB`)
    }

    // 5. 读取文件
    const buffer = fs.readFileSync(filePath)

    // 6. 转换为 Base64
    const base64 = buffer.toString('base64')

    // 7. 确定 MIME 类型
    const mimeType = this.getMimeType(ext)

    return {
      name: fileName,
      mimeType,
      data: base64,
      size: stats.size,
      path: filePath,
    }
  }

  /**
   * 从 Data URL 上传图片
   *
   * @param dataUrl - Data URL
   * @returns ImageInfo 图片信息
   */
  uploadFromDataUrl(dataUrl: string): ImageInfo {
    // 解析 Data URL
    // 格式：data:image/png;base64,iVBORw0KGgo...
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)

    if (!matches) {
      throw new Error('无效的 Data URL 格式')
    }

    const mimeType = matches[1]
    const base64 = matches[2]

    // 计算大小（Base64 解码后的大小）
    const size = Math.floor((base64.length * 3) / 4)

    // 验证大小
    if (size > this.config.maxFileSize) {
      const maxMB = (this.config.maxFileSize / (1024 * 1024)).toFixed(1)
      const fileMB = (size / (1024 * 1024)).toFixed(1)
      throw new Error(`图片过大: ${fileMB}MB。最大支持: ${maxMB}MB`)
    }

    return {
      name: 'pasted-image.png',
      mimeType,
      data: base64,
      size,
    }
  }

  /**
   * 获取 MIME 类型
   *
   * @param ext - 文件扩展名
   * @returns string MIME 类型
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
    }

    return mimeTypes[ext] || 'image/png'
  }

  /**
   * 格式化文件大小
   *
   * @param bytes - 字节数
   * @returns string 格式化后的大小
   */
  formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }
  }
}
