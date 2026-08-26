// sanitize-html 未随包提供类型声明，这里给出最小形状以通过 tsc / dts 构建。
declare module 'sanitize-html' {
  interface SanitizeOptions {
    [key: string]: unknown;
  }
  const sanitizeHtml: {
    (html: string, options?: SanitizeOptions): string;
    defaults: {
      allowedTags: string[];
      allowedAttributes: Record<string, string[]>;
    };
  };
  export default sanitizeHtml;
}
