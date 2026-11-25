/** 业务错误：由 app.ts 的错误处理统一转成 { error, code } */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
