/** 链接只负责识别，真实路径和行列号由扩展宿主解析并交给 VS Code 打开。 */
export function isLocalFileReference(value: string, explicitLink = false): boolean {
  const target = value.trim()
  if (!target || /[\r\n]/.test(target) || target.startsWith('#')) return false
  if (/^file:\/\//i.test(target)) return true
  if (/^[A-Za-z]:[/\\]/.test(target)) return true
  const path = target.replace(/(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?|:\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?)$/i, '')
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return false
  if (explicitLink) return true
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte|json|md|mdx|css|scss|less|html?|xml|ya?ml|toml|py|java|go|rs|c|h|cpp|hpp|cs|php|rb|swift|kt|kts|sql|sh|ps1|bat|txt|log|png|jpe?g|gif|webp|svg)$/i.test(path) ||
    /(?:^|[/\\])(?:\.env(?:\.[\w-]+)?|Dockerfile|Makefile|LICENSE|README|AGENTS\.md)$/i.test(path)
}
