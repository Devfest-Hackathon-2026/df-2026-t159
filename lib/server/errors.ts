/**
 * Route Handler 用のエラー型（Issue 2）。
 * code はクライアントへ返す機械可読な識別子で、本文・トークン等の機微情報は含めない。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
