import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ScreenFrame } from './match';

interface ScreenReaderPlugin {
  start(options: { intervalMs: number }): Promise<void>;
  stop(): Promise<void>;
  snapshot(): Promise<void>;
  setInterval(options: { intervalMs: number }): Promise<void>;
  addListener(event: 'screenText', cb: (frame: ScreenFrame) => void): Promise<PluginListenerHandle>;
  addListener(event: 'stopped', cb: (info: { reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'snapshot', cb: (info: { saved: boolean }) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<ScreenReaderPlugin>('ScreenReader');

/** La lecture d'écran n'existe que dans l'app Android. */
export const screenReaderAvailable = () => Capacitor.getPlatform() === 'android';

export async function startScreenReader(
  onFrame: (frame: ScreenFrame) => void,
  onStopped: (reason: string) => void,
  onSnapshot: (saved: boolean) => void,
): Promise<() => Promise<void>> {
  const handles = [
    await plugin.addListener('screenText', onFrame),
    await plugin.addListener('stopped', (info) => onStopped(info.reason)),
    await plugin.addListener('snapshot', (info) => onSnapshot(info.saved)),
  ];
  try {
    await plugin.start({ intervalMs: 1500 });
  } catch (e) {
    await Promise.all(handles.map((h) => h.remove()));
    throw e;
  }
  return async () => {
    await Promise.all(handles.map((h) => h.remove()));
    await plugin.stop();
  };
}

/** Demande à l'app d'enregistrer dans la galerie (album CoopTFT) la prochaine image qu'elle capture. */
export const requestSnapshot = () => plugin.snapshot().catch(() => {});

/** Change la cadence de capture sans relancer la lecture. */
export const setReaderInterval = (intervalMs: number) => plugin.setInterval({ intervalMs }).catch(() => {});
