import Phaser from 'phaser';
import type { GameSpec } from '@game-creator/contracts';

const color = (hex: string) => Number.parseInt(hex.slice(1), 16);
type KeyMap = Record<'a' | 'd' | 'w' | 's', Phaser.Input.Keyboard.Key>;
type Enemy = { body: Phaser.Physics.Arcade.Image; spec: GameSpec['enemies'][number]; direction: number };

/** Trusted renderer: the spec selects bounded data, never source code or assets. */
export class GameSpecScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Image;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private keys: KeyMap | undefined;
  private enemies: Enemy[] = [];
  private hud!: Phaser.GameObjects.Text;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hits!: Phaser.GameObjects.Particles.ParticleEmitter;
  private score = 0;
  private collected = 0;
  private health = 0;
  private startedAt = 0;
  private protectedUntil = 0;
  private groundedAt = -1000;
  private jumpAt = -1000;
  private finished = false;
  private lastHud = '';
  private touch = { left: false, right: false, up: false, down: false };

  constructor(private readonly spec: GameSpec, private readonly onStarted: () => void) { super('game-spec'); }

  create() {
    this.score = 0; this.collected = 0; this.health = this.spec.player.health;
    this.startedAt = this.time.now; this.protectedUntil = 0; this.finished = false;
    this.groundedAt = -1000; this.jumpAt = -1000; this.lastHud = ''; this.enemies = [];
    this.touch = { left: false, right: false, up: false, down: false };
    this.physics.resume();
    const { theme, player, genre } = this.spec;
    this.cameras.main.setBackgroundColor(theme.background);
    const art = this.add.graphics();
    art.lineStyle(1, color(theme.accent), 0.09);
    for (let x = 0; x < 960; x += 40) art.lineBetween(x, 70, x, 540);
    for (let y = 80; y < 540; y += 40) art.lineBetween(0, y, 960, y);
    this.add.rectangle(480, 35, 960, 70, 0x060d18, 0.8);
    this.add.text(22, 12, this.spec.title, { fontFamily: 'system-ui', fontSize: '20px', color: '#ffffff' });
    this.hud = this.add.text(22, 43, '', { fontFamily: 'system-ui', fontSize: '13px', color: '#d6e1ee' }).setDepth(10);
    this.add.text(938, 18, genre === 'platformer' ? 'PLATFORMER' : 'COLLECT & DODGE', { fontFamily: 'monospace', fontSize: '12px', color: theme.accent }).setOrigin(1, 0);
    if (!this.textures.exists('spec-player')) {
      const texture = this.make.graphics({ x: 0, y: 0 });
      // Canvas does not apply Image tint: bake validated theme colors into pixels.
      texture.fillStyle(color(theme.player)).fillRoundedRect(0, 0, 40, 40, 6);
      texture.fillStyle(0x101b30).fillRect(8, 13, 24, 10);
      texture.fillStyle(0xffffff).fillRect(11, 15, 5, 5).fillRect(24, 15, 5, 5);
      texture.generateTexture('spec-player', 40, 40);
      texture.clear().fillStyle(color(theme.enemy)).fillRoundedRect(0, 0, 40, 40, 5);
      texture.fillStyle(0x101b30).fillRect(7, 12, 8, 7).fillRect(25, 12, 8, 7);
      texture.generateTexture('spec-enemy', 40, 40);
      texture.clear().fillStyle(color(theme.collectible)).fillCircle(10, 10, 8);
      texture.generateTexture('spec-coin', 20, 20);
      texture.destroy();
    }
    this.physics.world.setBounds(0, 70, 960, genre === 'platformer' ? 470 : 430);
    const blocks = this.physics.add.staticGroup();
    const placements = [...this.spec.platforms, ...this.spec.obstacles];
    if (genre === 'platformer') placements.push({ x: 480, y: 520, width: 960, height: 40 });
    for (const block of placements) {
      const shape = this.add.rectangle(block.x, block.y, block.width, block.height, color(theme.platform));
      blocks.add(shape);
      shape.setStrokeStyle(2, color(theme.accent), 0.7);
    }
    this.player = this.physics.add.image(player.x, player.y, 'spec-player').setDisplaySize(player.size, player.size);
    this.player.setCollideWorldBounds(true).setMaxVelocity(500, 1000);
    this.player.setData('kind', 'player');
    this.physics.add.collider(this.player, blocks);

    for (const spec of this.spec.enemies) {
      const body = this.physics.add.image(spec.x, spec.y, 'spec-enemy').setDisplaySize(spec.size, spec.size);
      body.body.setAllowGravity(false);
      body.setImmovable(true).setCollideWorldBounds(true);
      const enemy = { body, spec, direction: 1 };
      this.enemies.push(enemy);
      this.physics.add.collider(body, blocks, () => { enemy.direction *= -1; });
      this.physics.add.overlap(this.player, body, () => this.damage(spec.damage));
    }
    const coins = this.physics.add.staticGroup();
    for (const item of this.spec.collectibles) {
      const coin = this.physics.add.staticImage(item.x, item.y, 'spec-coin');
      coin.setData('value', item.value);
      coins.add(coin);
    }
    // Particles reuse the generated coin/enemy textures; no player-colored pixels.
    const burst = { speed: { min: 60, max: 180 }, lifespan: 380, alpha: { start: 1, end: 0 }, emitting: false };
    this.sparks = this.add.particles(0, 0, 'spec-coin', { ...burst, scale: { start: 0.6, end: 0 } }).setDepth(5);
    this.hits = this.add.particles(0, 0, 'spec-enemy', { ...burst, scale: { start: 0.25, end: 0 } }).setDepth(5);
    this.physics.add.overlap(this.player, coins, (_player, object) => {
      if (this.finished || !(object instanceof Phaser.Physics.Arcade.Image) || !object.active) return;
      this.score += Number(object.getData('value'));
      this.collected += 1;
      this.sparks.explode(10, object.x, object.y);
      object.disableBody(true, true);
      this.checkWin(0);
    });
    this.setupControls();
    const result = document.getElementById('game-result');
    if (result) result.hidden = true;
    const restart = () => this.scene.restart();
    const button = document.getElementById('restart-game');
    button?.addEventListener('click', restart);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => button?.removeEventListener('click', restart));
    this.updateHud(0);
    this.onStarted();
  }

  update(time: number) {
    if (this.finished || !this.cursors || !this.keys) return;
    const { controls, player, genre } = this.spec;
    const arrows = controls.movement !== 'wasd';
    const wasd = controls.movement !== 'arrows';
    const left = this.touch.left || (arrows && this.cursors.left.isDown) || (wasd && this.keys.a.isDown);
    const right = this.touch.right || (arrows && this.cursors.right.isDown) || (wasd && this.keys.d.isDown);
    const up = this.touch.up || (arrows && this.cursors.up.isDown) || (wasd && this.keys.w.isDown);
    const down = this.touch.down || (arrows && this.cursors.down.isDown) || (wasd && this.keys.s.isDown);
    const dx = Number(right) - Number(left);
    if (genre === 'top-down') {
      const dy = Number(down) - Number(up);
      const factor = dx && dy ? Math.SQRT1_2 : 1;
      this.player.setVelocity(dx * player.speed * factor, dy * player.speed * factor);
    } else {
      this.player.setVelocityX(dx * player.speed);
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      if (body.blocked.down || body.touching.down) this.groundedAt = time;
      if (time - this.groundedAt < 90 && time - this.jumpAt < 120) {
        this.player.setVelocityY(-player.jumpSpeed);
        this.groundedAt = -1000; this.jumpAt = -1000;
      }
    }
    for (const enemy of this.enemies) {
      const { spec, body } = enemy;
      const coordinate = spec.axis === 'horizontal' ? body.x : body.y;
      const center = spec.axis === 'horizontal' ? spec.x : spec.y;
      if (coordinate >= center + spec.range) enemy.direction = -1;
      if (coordinate <= center - spec.range) enemy.direction = 1;
      const velocity = spec.range ? enemy.direction * spec.speed * this.spec.difficulty.enemySpeedMultiplier : 0;
      body.setVelocity(spec.axis === 'horizontal' ? velocity : 0, spec.axis === 'vertical' ? velocity : 0);
    }
    this.player.setAlpha(time < this.protectedUntil && Math.floor(time / 90) % 2 === 0 ? 0.35 : 1);
    const elapsed = Math.floor((time - this.startedAt) / 1000);
    this.checkWin(elapsed);
    if (!this.finished && this.spec.lose.timeLimitSeconds > 0 && elapsed >= this.spec.lose.timeLimitSeconds) this.finish(false, 'Đã hết thời gian.');
    this.updateHud(elapsed);
  }

  private damage(amount: number) {
    if (this.finished || this.time.now < this.protectedUntil) return;
    this.health = Math.max(0, this.health - amount);
    this.protectedUntil = this.time.now + this.spec.difficulty.invulnerabilityMs;
    this.hits.explode(8, this.player.x, this.player.y);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.cameras.main.shake(120, 0.004);
    if (this.health === 0) this.finish(false, 'Bạn đã hết máu.');
    this.updateHud(Math.floor((this.time.now - this.startedAt) / 1000));
  }

  private checkWin(elapsed: number) {
    if (this.finished) return;
    const win = this.spec.win;
    if ((win.type === 'collect_all' && this.collected === this.spec.collectibles.length)
      || (win.type === 'reach_score' && this.score >= win.scoreTarget)
      || (win.type === 'survive' && elapsed >= win.surviveSeconds)) this.finish(true, 'Bạn đã hoàn thành mục tiêu!');
  }

  private updateHud(elapsed: number) {
    const win = this.spec.win;
    const objective = win.type === 'collect_all' ? `Xu ${this.collected}/${this.spec.collectibles.length}`
      : win.type === 'reach_score' ? `Mục tiêu ${win.scoreTarget} điểm` : `Sống sót ${win.surviveSeconds}s`;
    const timer = this.spec.lose.timeLimitSeconds > 0 ? `Còn ${Math.max(0, this.spec.lose.timeLimitSeconds - elapsed)}s` : `${elapsed}s`;
    const text = `Máu ${this.health}/${this.spec.player.health}  ·  Điểm ${this.score}  ·  ${objective}  ·  ${timer}  ·  R: chơi lại`;
    if (text === this.lastHud) return;
    this.lastHud = text;
    this.hud.setText(text);
    const status = document.getElementById('game-hud');
    if (status) { status.hidden = false; status.textContent = text; }
  }

  private finish(won: boolean, explanation: string) {
    this.finished = true;
    this.physics.pause();
    this.player.setAlpha(1);
    const result = document.getElementById('game-result');
    const title = document.getElementById('result-title');
    const detail = document.getElementById('result-detail');
    if (result && title && detail) {
      title.textContent = won ? 'Bạn thắng!' : 'Game over';
      detail.textContent = `${explanation} Điểm: ${this.score}.`;
      result.hidden = false;
    }
    this.updateHud(Math.floor((this.time.now - this.startedAt) / 1000));
  }

  private setupControls() {
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keys = this.input.keyboard?.addKeys('a,d,w,s') as KeyMap | undefined;
    this.input.keyboard?.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'W', 'A', 'S', 'D']);
    const jump = (event: KeyboardEvent) => { if (!event.repeat) this.jumpAt = this.time.now; };
    const restart = (event: KeyboardEvent) => { if (!event.repeat) this.scene.restart(); };
    const bindings = ['keydown-R'];
    this.input.keyboard?.on('keydown-R', restart);
    if (this.spec.controls.jump !== 'up') bindings.push('keydown-SPACE');
    if (this.spec.controls.jump !== 'space') bindings.push('keydown-UP', 'keydown-W');
    bindings.slice(1).forEach((name) => this.input.keyboard?.on(name, jump));
    const cleanup: Array<() => void> = [];
    const clear = () => {
      this.touch = { left: false, right: false, up: false, down: false };
      this.input.keyboard?.resetKeys();
      if (this.spec.genre === 'top-down') this.player.setVelocity(0); else this.player.setVelocityX(0);
    };
    window.addEventListener('blur', clear);
    for (const [id, key] of [['move-left', 'left'], ['move-right', 'right'], ['move-up', 'up'], ['move-down', 'down'], ['jump', 'jump']] as const) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.hidden = key === 'jump' ? this.spec.genre !== 'platformer' : (key === 'up' || key === 'down') && this.spec.genre !== 'top-down';
      const down = (event: PointerEvent) => {
        event.preventDefault(); button.setPointerCapture(event.pointerId);
        if (key === 'jump') this.jumpAt = this.time.now; else this.touch[key] = true;
      };
      const up = () => { if (key !== 'jump') this.touch[key] = false; };
      button.addEventListener('pointerdown', down);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, up);
      cleanup.push(() => {
        button.removeEventListener('pointerdown', down);
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.removeEventListener(name, up);
      });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-R', restart);
      bindings.slice(1).forEach((name) => this.input.keyboard?.off(name, jump));
      window.removeEventListener('blur', clear);
      cleanup.forEach((remove) => remove());
    });
  }
}
