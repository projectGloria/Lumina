/// <reference types="vite/client" />

/**
 * `turndown-plugin-gfm` ships no types and has no `@types` package. Only the
 * one export is used, so declaring it here is cheaper and more honest than
 * pulling in a hand-written stub package.
 */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  export const gfm: TurndownService.Plugin
  export const tables: TurndownService.Plugin
  export const strikethrough: TurndownService.Plugin
  export const taskListItems: TurndownService.Plugin
}

/**
 * `MediaStreamTrackProcessor` is WebCodecs and not yet in TypeScript's DOM
 * library, though Chromium has shipped it for years. Live dictation needs it
 * for a continuous PCM feed — a `MediaRecorder` only yields container blobs,
 * and a blob cannot be re-transcribed mid-phrase.
 */
interface AudioDataCopyToOptions {
  planeIndex: number
  format?: string
  frameOffset?: number
  frameCount?: number
}

declare class AudioData {
  readonly sampleRate: number
  readonly numberOfFrames: number
  readonly numberOfChannels: number
  allocationSize(options: AudioDataCopyToOptions): number
  copyTo(destination: Float32Array, options: AudioDataCopyToOptions): void
  close(): void
}

declare class MediaStreamTrackProcessor<T = AudioData> {
  constructor(init: { track: MediaStreamTrack })
  readonly readable: ReadableStream<T>
}
