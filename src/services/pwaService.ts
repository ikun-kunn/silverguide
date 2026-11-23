import { readonly, ref, shallowRef } from 'vue';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** 浏览器安装与离线状态：不依赖网络接口，不持有学习或截图数据。 */
export function createPwaController(reloadPage = () => window.location.reload()) {
  const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false);
  const offlineReady = ref(false);
  const installed = ref(false);
  const ios = ref(false);
  const prompt = shallowRef<InstallPromptEvent | null>(null);
  const message = ref('');
  /** 新版本 SW 已安装等待接管：给非阻断刷新提示，不自动切换版本。 */
  const updateReady = ref(false);
  const updating = ref(false);
  let waitingWorker: ServiceWorker | null = null;
  let detach: (() => void) | null = null;
  let cancelUpdate: (() => void) | null = null;
  let updateAttempt = 0;

  function initialize(production = import.meta.env.PROD): void {
    if (typeof window === 'undefined' || detach) return;
    online.value = navigator.onLine !== false;
    const platform = navigator.userAgent || '';
    ios.value = /iPhone|iPod|iPad/i.test(platform) || (/Macintosh/i.test(platform) && navigator.maxTouchPoints > 1);
    installed.value = window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const updateOnline = () => { online.value = navigator.onLine !== false; };
    const handlePrompt = (event: Event) => { event.preventDefault(); prompt.value = event as InstallPromptEvent; message.value = ''; };
    const handleInstalled = () => { installed.value = true; prompt.value = null; message.value = '已安装到设备。'; };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    let mounted = true;
    const workerListeners: (() => void)[] = [];
    const registrations = new Set<ServiceWorkerRegistration>();
    const workers = new Set<ServiceWorker>();
    detach = () => {
      mounted = false;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      workerListeners.splice(0).forEach(remove => remove());
    };
    if (production && window.isSecureContext && 'serviceWorker' in navigator) {
      const url = new URL(`${import.meta.env.BASE_URL}service-worker.js`, window.location.origin);
      const watchRegistration = (registration: ServiceWorkerRegistration): void => {
        if (!mounted || registrations.has(registration)) return;
        registrations.add(registration);
        const watchInstalling = () => {
          const incoming = registration.installing;
          if (!incoming || workers.has(incoming)) return;
          workers.add(incoming);
          const onState = () => {
            // installing -> installed 且已有 controlling worker 表示新版本等待接管。
            if (incoming.state === 'installed' && navigator.serviceWorker.controller && mounted) {
              waitingWorker = incoming;
              updateReady.value = true;
            }
          };
          incoming.addEventListener('statechange', onState);
          workerListeners.push(() => incoming.removeEventListener('statechange', onState));
          onState();
        };
        registration.addEventListener('updatefound', watchInstalling);
        workerListeners.push(() => registration.removeEventListener('updatefound', watchInstalling));
        watchInstalling();
        if (registration.waiting && navigator.serviceWorker.controller && mounted) {
          waitingWorker = registration.waiting;
          updateReady.value = true;
        }
      };
      void navigator.serviceWorker.register(url).then((registration) => {
        if (!mounted) return;
        watchRegistration(registration);
        void navigator.serviceWorker.ready.then(() => {
          if (mounted) offlineReady.value = true;
          void navigator.serviceWorker.getRegistration().then((current) => {
            if (current && current !== registration) watchRegistration(current);
          }).catch(() => {});
        });
      }).catch(() => { if (mounted) offlineReady.value = false; });
    }
  }

  /** 仅用户主动确认后等待存档、激活并刷新一次。 */
  async function applyUpdate(flushWrites = async () => true): Promise<void> {
    if (!waitingWorker || updating.value) return;
    const worker = waitingWorker;
    const attempt = ++updateAttempt;
    updating.value = true;
    message.value = '正在确认学习进度已保存…';
    try {
      const saved = await flushWrites();
      if (attempt !== updateAttempt) return;
      if (!saved) {
        updating.value = false;
        message.value = '学习进度尚未确认保存，请稍后重试更新。';
        return;
      }
      const container = navigator.serviceWorker;
      const previous = container.controller;
      let finishing = false;
      const finish = async () => {
        if (attempt !== updateAttempt || finishing) return;
        finishing = true;
        cancelUpdate?.(); cancelUpdate = null;
        // 接管等待期间用户仍可能发起新的学习操作；刷新前再次确认写入完成。
        try {
          const readyToReload = await flushWrites();
          if (attempt !== updateAttempt) return;
          if (!readyToReload) throw new Error('Pending progress');
          waitingWorker = null; updating.value = false; updateReady.value = false;
          reloadPage();
        } catch {
          if (attempt !== updateAttempt) return;
          waitingWorker = container.controller ?? worker;
          updating.value = false; updateReady.value = true;
          message.value = '新版本已准备好，学习进度尚未确认保存。请稍后再更新。';
        }
      };
      const onControllerChange = () => { if (container.controller && container.controller !== previous) void finish(); };
      if (previous === worker) { await finish(); return; }
      const timer = setTimeout(() => {
        cancelUpdate?.(); cancelUpdate = null;
        updating.value = false;
        updateReady.value = worker.state === 'installed';
        message.value = '新版本接管尚未完成，请稍后重试或手动刷新。';
      }, 15_000);
      cancelUpdate = () => { clearTimeout(timer); container.removeEventListener('controllerchange', onControllerChange); };
      container.addEventListener('controllerchange', onControllerChange);
      updateReady.value = false;
      message.value = '新版本正在加载，页面即将更新。';
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      if (attempt !== updateAttempt) return;
      cancelUpdate?.(); cancelUpdate = null;
      updating.value = false; updateReady.value = true;
      message.value = '暂时无法更新，请稍后重试。';
    }
  }

  async function install(): Promise<void> {
    const event = prompt.value;
    if (!event) return;
    prompt.value = null; // 每个安装事件只能使用一次
    try {
      await event.prompt();
      const result = await event.userChoice;
      message.value = result.outcome === 'accepted' ? '安装请求已提交。' : '暂未安装，仍可在浏览器使用。';
    } catch { message.value = '暂时无法安装，请继续使用浏览器。'; }
  }

  function dispose(): void {
    updateAttempt++;
    cancelUpdate?.(); cancelUpdate = null; updating.value = false;
    detach?.(); detach = null; prompt.value = null; offlineReady.value = false;
    waitingWorker = null; updateReady.value = false;
  }
  return {
    online: readonly(online), offlineReady: readonly(offlineReady), installed: readonly(installed),
    ios: readonly(ios), prompt: readonly(prompt), message: readonly(message),
    updateReady: readonly(updateReady), updating: readonly(updating), initialize, install, applyUpdate, dispose,
  };
}

export const pwa = createPwaController();
