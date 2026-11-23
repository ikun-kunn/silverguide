/**
 * 单一语音通道：任何新播报都会取消上一条。
 *
 * Chromium 桌面端对长 utterance 存在已知截断问题（crbug 679437）：
 * 单次朗读超过约 15 秒会中途停止且 onend 可能不触发。这里采用
 * 「按句切分队列 + 长段落定时保活」双重策略，确保完整播报不被静默截断；
 * 中文音色在 voiceschanged 异步就绪后再选择。
 */

import { warnDiagnostic } from '@/utils/diagnostics';

export type ChineseSpeechAvailability = 'unsupported' | 'no-chinese' | 'ready';

/** 每段上限（字符数）。中文按约 5 字/秒估算，120 字约 24 秒，留足余量。 */
export const MAX_SPEECH_SEGMENT_CHARS = 120;
/** 保活间隔：短于该间隔的段落不会启动定时器。 */
const KEEP_ALIVE_INTERVAL_MS = 8_000;

/** 将文本按中文句读切分为适合逐段朗读的片段，过长句再按长度拆分。 */
export function splitSpeechSegments(text: string, maxChars = MAX_SPEECH_SEGMENT_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.max(1, Math.floor(maxChars)) : MAX_SPEECH_SEGMENT_CHARS;
  const pieces = trimmed.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/gu) ?? [trimmed];
  const segments: string[] = [];
  let buffer = '';

  const flush = (): void => {
    if (buffer) {
      segments.push(buffer);
      buffer = '';
    }
  };

  for (const piece of pieces) {
    let remaining = piece;
    while (remaining.length > limit) {
      flush();
      segments.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
    if (buffer.length + remaining.length > limit) flush();
    buffer += remaining;
  }
  flush();
  return segments;
}

let speechToken = 0;
let clearActiveSpeechTimer: (() => void) | null = null;

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis &&
    typeof window.SpeechSynthesisUtterance === 'function' && typeof window.speechSynthesis.getVoices === 'function' &&
    typeof window.speechSynthesis.speak === 'function' && typeof window.speechSynthesis.cancel === 'function';
}

function pickChineseVoice(): SpeechSynthesisVoice | null {
  if (!canSpeak()) return null;
  try {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((item) => /^(?:zh[-_](CN|Hans)(?:[-_]|$)|cmn(?:[-_]|$))/i.test(item.lang))
      ?? voices.find((item) => /^zh(?:[-_]|$)/i.test(item.lang))
      ?? null;
  } catch (error) {
    warnDiagnostic('speech.voices', error);
    return null;
  }
}

export function getSpeechAvailability(): ChineseSpeechAvailability {
  return !canSpeak() ? 'unsupported' : pickChineseVoice() ? 'ready' : 'no-chinese';
}

/** 浏览器异步加载语音资源，消费者可订阅更新，卸载后移除监听。 */
export function observeSpeechAvailability(onChange: (state: ChineseSpeechAvailability) => void): () => void {
  const refresh = () => onChange(getSpeechAvailability());
  refresh();
  if (!canSpeak()) return () => {};
  const synthesis = window.speechSynthesis;
  if (typeof synthesis.addEventListener !== 'function') return () => {};
  try { synthesis.addEventListener('voiceschanged', refresh); }
  catch (error) { warnDiagnostic('speech.observe', error); return () => {}; }
  return () => {
    try { synthesis.removeEventListener?.('voiceschanged', refresh); }
    catch (error) { warnDiagnostic('speech.observe', error); }
  };
}

export function stopSpeech(): void {
  // 递增 token 使在途队列的所有回调失效，避免旧队列继续朗读下一段。
  speechToken += 1;
  clearActiveSpeechTimer?.();
  clearActiveSpeechTimer = null;
  if (canSpeak()) {
    try { window.speechSynthesis.cancel(); } catch (error) { warnDiagnostic('speech.cancel', error); }
  }
}

export interface SpeakHooks {
  onEnd?: () => void;
  onError?: () => void;
}

/** 逐段朗读整段文本；任一新播报或 stopSpeech 都会取消当前队列。 */
export function speakChinese(text: string, rate = 1, hooks?: SpeakHooks): boolean {
  const segments = splitSpeechSegments(text);
  if (!canSpeak() || segments.length === 0) return false;
  const voice = pickChineseVoice();
  if (!voice) return false; // 无中文音色时明确降级，不使用可能为非中文的默认音色。
  stopSpeech();

  const token = speechToken;
  const safeRate = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
  let index = 0;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearKeepAlive = (): void => {
    if (keepAlive !== null) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  };
  const clearTimers = (): void => {
    clearKeepAlive();
    if (watchdog !== null) { clearTimeout(watchdog); watchdog = null; }
  };
  clearActiveSpeechTimer = clearTimers;

  const speakNext = (): void => {
    if (token !== speechToken) return;
    if (index >= segments.length) {
      clearTimers(); clearActiveSpeechTimer = null;
      hooks?.onEnd?.();
      return;
    }

    const segment = segments[index] ?? '';
    index += 1;
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new window.SpeechSynthesisUtterance(segment);
    } catch (error) {
      warnDiagnostic('speech.utterance', error);
      clearTimers(); clearActiveSpeechTimer = null;
      hooks?.onError?.();
      return;
    }

    utterance.lang = 'zh-CN';
    utterance.rate = safeRate;
    utterance.voice = voice;

    let finished = false;
    const finish = (): void => {
      if (finished || token !== speechToken) return;
      finished = true;
      clearTimers();
      utterance.onend = null;
      utterance.onerror = null;
      speakNext();
    };
    utterance.onend = finish;
    const fail = (): void => {
      if (token !== speechToken || finished) return;
      finished = true;
      clearTimers();
      utterance.onend = null;
      utterance.onerror = null;
      stopSpeech();
      hooks?.onError?.();
    };
    utterance.onerror = fail;

    // 不能依赖浏览器一定触发 end/error。每段留出充分启动和朗读时间，超时安全降级。
    watchdog = setTimeout(fail, Math.max(15_000, Math.ceil(segment.length * 1000 / (3 * safeRate)) + 15_000));

    // 仅长段落启动保活，避免 Chromium 在长时间朗读后静默停摆。
    if (segment.length * 1000 / (5 * safeRate) >= KEEP_ALIVE_INTERVAL_MS) keepAlive = setInterval(() => {
      if (token !== speechToken || finished) {
        clearKeepAlive();
        return;
      }
      try {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      } catch {
        clearKeepAlive();
      }
    }, KEEP_ALIVE_INTERVAL_MS);
    try {
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      warnDiagnostic('speech.play', error);
      fail();
    }
  };

  speakNext();
  return true;
}
