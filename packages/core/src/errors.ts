// 稳定错误码（不随文案变化），见方案第十六节。
export const PreviewErrorCode = {
  UNSUPPORTED: 'ERR_UNSUPPORTED',
  TOO_LARGE: 'ERR_TOO_LARGE',
  PARSE: 'ERR_PARSE',
  ABORTED: 'ERR_ABORTED',
  TIMEOUT: 'ERR_TIMEOUT',
} as const;

export type PreviewErrorCode = (typeof PreviewErrorCode)[keyof typeof PreviewErrorCode];

export class PreviewAbortError extends Error {
  code = PreviewErrorCode.ABORTED;
  constructor(message = 'Preview aborted') {
    super(message);
    this.name = 'PreviewAbortError';
  }
}

export class PreviewTimeoutError extends Error {
  code = PreviewErrorCode.TIMEOUT;
  constructor(message = 'Preview timed out') {
    super(message);
    this.name = 'PreviewTimeoutError';
  }
}
