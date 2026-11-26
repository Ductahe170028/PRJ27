import Phaser from 'phaser';
import { RuntimeInitSchema, type RuntimeEvent } from '@game-creator/contracts';
import { ShooterScene } from './ShooterScene';

const script = document.getElementById('game-runtime');
const sessionId = script?.getAttribute('data-session-id');
const parentOrigin = script?.getAttribute('data-parent-origin');
let game: Phaser.Game | undefined;
let initialized = false;

function notify(type: RuntimeEvent['type']) {
  if (!sessionId || !parentOrigin) return;
  const message: RuntimeEvent = { channel: 'game-creator', sessionId, type };
  window.parent.postMessage(message, parentOrigin);
}

function fail() {
  notify('runtime:error');
  const status = document.getElementById('runtime-status');
  if (status) status.textContent = 'Không thể khởi chạy game. Hãy tạo lại từ workspace.';
}

window.addEventListener('error', fail);
window.addEventListener('unhandledrejection', fail);
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || event.origin !== parentOrigin || initialized) return;
  const result = RuntimeInitSchema.safeParse(event.data);
  if (!result.success || result.data.sessionId !== sessionId) return;
  initialized = true;
  window.clearInterval(readyTimer);
  const level = result.data.game;
  const started = () => {
    const status = document.getElementById('runtime-status');
    if (status) status.hidden = true;
    notify('runtime:started');
  };
  try {
    game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: 'game',
      width: level.width,
      height: level.height,
      backgroundColor: '#101b30',
      pixelArt: true,
      roundPixels: true,
      banner: false,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
      scene: [new ShooterScene(level, started)],
      callbacks: {
        postBoot: (instance) => {
          instance.canvas.tabIndex = 0;
          instance.canvas.setAttribute('aria-label', `${level.title}. Chọn khung game. WASD di chuyển, chuột để ngắm và bắn, R chơi lại.`);
          instance.canvas.addEventListener('pointerdown', () => instance.canvas.focus());
        },
      },
    });
  } catch {
    fail();
  }
});

window.addEventListener('pagehide', () => game?.destroy(true), { once: true });
// Retry the handshake if the parent's effect was not listening on first load.
const readyTimer = window.setInterval(() => {
  if (!initialized) notify('runtime:ready');
}, 250);
notify('runtime:ready');
