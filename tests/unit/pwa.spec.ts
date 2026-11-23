import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPwaController } from '@/services/pwaService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // jsdom 默认没有 serviceWorker；测试注入后显式移除，避免污染其他用例。
  if (Object.prototype.hasOwnProperty.call(navigator, 'serviceWorker')) {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
});

describe('M3 PWA 浏览器状态', () => {
  it('只有浏览器给出安装事件才允许触发一次安装', async () => {
    const controller = createPwaController(); controller.initialize(false);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'accepted' }) });
    expect(controller.prompt.value).toBeNull();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.prompt.value).not.toBeNull();
    await controller.install(); await controller.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(controller.message.value).toContain('安装请求已提交');
    window.dispatchEvent(new Event('appinstalled'));
    expect(controller.installed.value).toBe(true);
    controller.dispose();
  });
  it('用户确认且存档完成后发送 SKIP_WAITING，接管时仅刷新一次', async () => {
    const waiting = { postMessage: vi.fn(), state: 'installed' };
    const registration = Object.assign(new EventTarget(), {
      waiting,
    });
    const sw = Object.assign(new EventTarget(), {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      controller: { postMessage: vi.fn() },
      getRegistration: vi.fn(async () => registration),
    });
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true, value: sw as unknown as ServiceWorkerContainer,
    });

    const reload = vi.fn();
    const controller = createPwaController(reload);
    controller.initialize(true);
    await vi.waitFor(() => expect(controller.updateReady.value).toBe(true));
    expect(controller.offlineReady.value).toBe(true);

    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    await controller.applyUpdate(async () => false);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(controller.updateReady.value).toBe(true);
    let allowSave!: (value: boolean) => void;
    const flushWrites = vi.fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise<boolean>(resolve => { allowSave = resolve; }))
      .mockResolvedValue(true);
    const pending = controller.applyUpdate(flushWrites);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    allowSave(true); await pending;
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(controller.updateReady.value).toBe(false);
    expect(controller.message.value).toContain('新版本正在加载');
    expect(reload).not.toHaveBeenCalled();
    sw.controller = waiting;
    sw.dispatchEvent(new Event('controllerchange'));
    sw.dispatchEvent(new Event('controllerchange'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(flushWrites).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('随浏览器断网/恢复更新，并在销毁时移除监听', () => {
    const state = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const controller = createPwaController(); controller.initialize(false);
    state.mockReturnValue(false); window.dispatchEvent(new Event('offline'));
    expect(controller.online.value).toBe(false);
    expect(controller.offlineReady.value).toBe(false);
    state.mockReturnValue(true); window.dispatchEvent(new Event('online'));
    expect(controller.online.value).toBe(true);
    controller.dispose();
    state.mockReturnValue(false); window.dispatchEvent(new Event('offline'));
    expect(controller.online.value).toBe(true);
  });
});
