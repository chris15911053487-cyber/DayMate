/** 语音识别接口：P1 用百度短语音，以后可换讯飞 / 阿里 / 流式识别，调用方不用改 */
export interface Asr {
  readonly provider: string
  /** wav：16k 单声道 16bit WAV 的 base64 */
  recognize(wavBase64: string, opts: { userId: string }): Promise<string>
}
