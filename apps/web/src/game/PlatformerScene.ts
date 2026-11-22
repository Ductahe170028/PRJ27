// Still used by demo mode (Moonlight Run); do not extend.
import Phaser from 'phaser';
import type { GameDefinition } from '@game-creator/contracts';

interface MovementKeys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
}

export class PlatformerScene extends Phaser.Scene {
  private player: Phaser.Physics.Arcade.Sprite | undefined;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private keys: MovementKeys | undefined;
  private touch = { left: false, right: false, jump: false };
  private previousTouchJump = false;
  private lastGroundedAt = -1_000;
  private jumpQueuedAt = -1_000;

  constructor(private readonly level: GameDefinition, private readonly onStarted: () => void) {
    super('platformer');
  }

  create() {
    this.drawWorld();
    this.createPlayerTexture();
    const platforms = this.physics.add.staticGroup();
    for (const [index, platform] of this.level.platforms.entries()) {
      const block = this.add.rectangle(platform.x, platform.y, platform.width, platform.height, 0x24394c);
      platforms.add(block);
      this.add.rectangle(platform.x, platform.y - platform.height / 2 + 2, platform.width, 4, 0x75c9cc);
      this.add.rectangle(platform.x, platform.y - platform.height / 2 - 3, platform.width + 8, 6, 0x75c9cc, 0.08);
      for (let x = platform.x - platform.width / 2 + 12; x < platform.x + platform.width / 2; x += 24) {
        this.add.rectangle(x, platform.y + 5, 8, 3, 0x39536a);
      }
      if (index > 0) {
        this.add.rectangle(platform.x, platform.y + platform.height / 2 + 9, platform.width - 16, 16, 0x152434);
        this.add.text(platform.x - platform.width / 2 + 8, platform.y + 29, `0${index}`, {
          fontFamily: 'monospace', fontSize: '10px', color: '#63778d',
        });
      }
    }

    this.player = this.physics.add.sprite(this.level.spawn.x, this.level.spawn.y, 'explorer');
    this.player.setSize(26, 34).setOffset(3, 2).setCollideWorldBounds(true).setMaxVelocity(500, 900);
    this.physics.add.collider(this.player, platforms);
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keys = this.input.keyboard?.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as MovementKeys | undefined;
    this.input.keyboard?.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
    const queueJump = (event: KeyboardEvent) => {
      if (!event.repeat) this.jumpQueuedAt = this.time.now;
    };
    const reset = (event: KeyboardEvent) => {
      if (event.repeat) return;
      this.player?.setPosition(this.level.spawn.x, this.level.spawn.y).setVelocity(0, 0);
      this.lastGroundedAt = -1_000;
      this.jumpQueuedAt = -1_000;
    };
    // Event handlers retain short taps even when down/up occur between frames.
    this.input.keyboard?.on('keydown-SPACE', queueJump);
    this.input.keyboard?.on('keydown-UP', queueJump);
    this.input.keyboard?.on('keydown-R', reset);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-SPACE', queueJump);
      this.input.keyboard?.off('keydown-UP', queueJump);
      this.input.keyboard?.off('keydown-R', reset);
    });

    this.add.text(28, 25, 'MOONLIGHT RUN', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e9f1', letterSpacing: 3,
    });
    this.add.text(28, 51, 'DEMO PLATFORMER / 01', {
      fontFamily: 'monospace', fontSize: '10px', color: '#788fa5', letterSpacing: 2,
    });
    this.add.text(932, 28, 'KHÁM PHÁ NHỮNG TẦNG CAO', {
      fontFamily: 'monospace', fontSize: '10px', color: '#93aabd', letterSpacing: 1,
    }).setOrigin(1, 0);
    this.createTouchControls();

    const clearInput = () => {
      this.touch = { left: false, right: false, jump: false };
      this.input.keyboard?.resetKeys();
      this.player?.setVelocityX(0);
    };
    window.addEventListener('blur', clearInput);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('blur', clearInput));
    this.onStarted();
  }

  update(time: number) {
    if (!this.player || !this.cursors || !this.keys) return;
    const body = this.player.body;
    if (!(body instanceof Phaser.Physics.Arcade.Body)) return;

    const left = this.cursors.left.isDown || this.keys.left.isDown || this.touch.left;
    const right = this.cursors.right.isDown || this.keys.right.isDown || this.touch.right;
    this.player.setVelocityX((Number(right) - Number(left)) * this.level.physics.moveSpeed);
    if (left !== right) this.player.setFlipX(left);

    const jumpPressed = this.touch.jump && !this.previousTouchJump;
    this.previousTouchJump = this.touch.jump;
    if (body.blocked.down || body.touching.down) this.lastGroundedAt = time;
    if (jumpPressed) this.jumpQueuedAt = time;
    // Short grace periods make jumping responsive without allowing a double jump.
    if (time - this.lastGroundedAt < 90 && time - this.jumpQueuedAt < 120) {
      this.player.setVelocityY(-this.level.physics.jumpSpeed);
      this.lastGroundedAt = -1_000;
      this.jumpQueuedAt = -1_000;
    }
  }

  private createPlayerTexture() {
    const art = this.make.graphics({ x: 0, y: 0 });
    art.fillStyle(0x91b752).fillRect(4, 4, 24, 30);
    art.fillStyle(0xc5f277).fillRect(2, 2, 28, 27);
    art.fillStyle(0xe0ffa4).fillRect(5, 2, 22, 3);
    art.fillStyle(0x1a302e).fillRect(7, 10, 18, 8);
    art.fillStyle(0x9be4df).fillRect(10, 12, 4, 3).fillRect(19, 12, 3, 3);
    art.fillStyle(0xc5f277).fillRect(4, 29, 8, 7).fillRect(20, 29, 8, 7);
    art.generateTexture('explorer', 32, 36);
    art.destroy();
  }

  private drawWorld() {
    const art = this.add.graphics();
    art.fillStyle(0x101b30).fillRect(0, 0, 960, 540);
    art.fillStyle(0x142239).fillRect(0, 260, 960, 280);
    // Deterministic pixel stars: no downloaded images or network requests.
    for (let i = 0; i < 76; i += 1) {
      const x = (i * 173 + 41) % 960;
      const y = (i * 79 + 17) % 390;
      art.fillStyle(i % 3 === 0 ? 0x9cbace : 0x4b6179, i % 3 === 0 ? 0.8 : 0.6);
      art.fillRect(x, y, i % 5 === 0 ? 3 : 2, 2);
    }
    art.fillStyle(0x839caa, 0.06).fillCircle(752, 123, 82);
    art.fillStyle(0x839caa, 0.08).fillCircle(752, 123, 65);
    art.fillStyle(0xc1d4d4).fillCircle(752, 123, 42);
    art.fillStyle(0x9fb7bf).fillRect(731, 100, 12, 8).fillRect(758, 128, 16, 12).fillRect(727, 133, 8, 6);
    art.fillStyle(0x1d2d45).fillPoints([
      { x: 0, y: 440 }, { x: 0, y: 302 }, { x: 80, y: 302 }, { x: 80, y: 273 },
      { x: 156, y: 273 }, { x: 156, y: 325 }, { x: 223, y: 325 }, { x: 223, y: 299 },
      { x: 291, y: 299 }, { x: 291, y: 364 }, { x: 383, y: 364 }, { x: 383, y: 338 },
      { x: 465, y: 338 }, { x: 465, y: 390 }, { x: 556, y: 390 }, { x: 556, y: 340 },
      { x: 635, y: 340 }, { x: 635, y: 306 }, { x: 711, y: 306 }, { x: 711, y: 347 },
      { x: 790, y: 347 }, { x: 790, y: 287 }, { x: 867, y: 287 }, { x: 867, y: 310 },
      { x: 960, y: 310 }, { x: 960, y: 440 },
    ], true);
    art.fillStyle(0x142336).fillPoints([
      { x: 0, y: 500 }, { x: 0, y: 389 }, { x: 123, y: 389 }, { x: 123, y: 420 },
      { x: 280, y: 420 }, { x: 280, y: 385 }, { x: 365, y: 385 }, { x: 365, y: 445 },
      { x: 543, y: 445 }, { x: 543, y: 392 }, { x: 660, y: 392 }, { x: 660, y: 422 },
      { x: 815, y: 422 }, { x: 815, y: 379 }, { x: 960, y: 379 }, { x: 960, y: 500 },
    ], true);
    art.lineStyle(1, 0x3e5c70, 0.12);
    for (let x = 0; x < 960; x += 48) art.lineBetween(x, 380, x, 500);
    for (let y = 404; y < 500; y += 32) art.lineBetween(0, y, 960, y);
    // A small beacon marks the highest platform.
    art.fillStyle(0x7c8baf).fillRect(894, 103, 3, 50);
    art.fillStyle(0xb1a0ec).fillRect(897, 103, 25, 15);
    art.fillStyle(0x7f73b4).fillRect(897, 115, 18, 3);
  }

  private createTouchControls() {
    const controls = [
      { id: 'move-left', key: 'left' as const },
      { id: 'move-right', key: 'right' as const },
      { id: 'jump', key: 'jump' as const },
    ];
    this.input.addPointer(2);
    const cleanups: Array<() => void> = [];
    for (const { id, key } of controls) {
      const button = document.getElementById(id);
      if (!button) continue;
      const down = (event: PointerEvent) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.touch[key] = true;
      };
      const up = () => { this.touch[key] = false; };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('lostpointercapture', up);
      cleanups.push(() => {
        button.removeEventListener('pointerdown', down);
        button.removeEventListener('pointerup', up);
        button.removeEventListener('pointercancel', up);
        button.removeEventListener('lostpointercapture', up);
      });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanups.forEach((cleanup) => cleanup()));
  }
}
