import Phaser from 'phaser';
import { RuntimeInitSchema, type GameSpec, type RuntimeEvent, type RuntimeGame, type ShooterLevel } from '@game-creator/contracts';
import { PlatformerScene } from './PlatformerScene';
import { GameSpecScene } from './GameSpecScene';
import { ShooterScene } from './ShooterScene';

const script = document.getElementById('game-runtime');
const sessionId = script?.getAttribute('data-session-id');
const parentOrigin = script?.getAttribute('data-parent-origin');
let game: Phaser.Game | undefined;
let initialized = false;

// What the iframe can play, told apart by the one field each kind owns. What is
// left after the shooter and the GameSpec is the Phase 1 demo.
const isShooter = (level: RuntimeGame): level is ShooterLevel => 'kind' in level;
const isSpec = (level: RuntimeGame): level is GameSpec => 'version' in level;

/** Downward pull of the Arcade world. Only the platformer and the demo fall. */
function gravityOf(level: RuntimeGame): number {
  if (isShooter(level)) return 0;
  if (isSpec(level)) return level.genre === 'platformer' ? level.difficulty.gravity : 0;
  return level.physics.gravity;
}

function sceneFor(level: RuntimeGame, started: () => void): Phaser.Scene {
  if (isShooter(level)) return new ShooterScene(level, started);
  if (isSpec(level)) return new GameSpecScene(level, started);
  return new PlatformerScene(level, started);
}

function canvasLabel(level: RuntimeGame): string {
  if (isShooter(level)) return `${level.title}. Chọn khung game. WASD di chuyển, chuột để ngắm và bắn, R chơi lại.`;
  if (isSpec(level)) return `${level.title}. Chọn khung game để điều khiển bằng bàn phím. R để chơi lại.`;
  return 'Moonlight Run. Di chuyển bằng A D hoặc phím mũi tên, nhảy bằng Space hoặc mũi tên lên.';
}

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
      physics: { default: 'arcade', arcade: { gravity: { x: 0, y: gravityOf(level) }, debug: false } },
      scene: [sceneFor(level, started)],
      callbacks: {
        postBoot: (instance) => {
          instance.canvas.tabIndex = 0;
          instance.canvas.setAttribute('aria-label', canvasLabel(level));
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
