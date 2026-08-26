// 依赖-free 兜底 sanitizer：剥离 <script>、on* 事件属性、javascript: 链接。
// 仅在没有安装 DOMPurify / sanitize-html 时作为安全降级使用；
// 生产环境应通过 createBrowserEnv/createNodeEnv 注入真实 sanitizer（见 sanitize-browser.ts / sanitize-node.ts）。
export function minimalSanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}
