// Draws the WORLD of a shooter (ground, base, enemies, player, bullets, pickups, effects) with sprites from art packs. It has no rule
// and no collision: it reads a ShooterState each frame and puts sprites where the simulation says, between the last two ticks
// (smooth on any screen). What the animations do is worked out from CHANGES between frames (render/events.ts), so the simulation
// stays as it was. Sprites are reused (pools): nothing is created per frame once the game is running.
import Phaser from 'phaser';
import {
  BASE_SIZE, BULLET_RADIUS, ENEMY_TYPES, PLAYER_RADIUS, TICK_RATE, isBoss, rangedOf,
  type EnemyType, type Look, type ShooterEnemy, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { packKey, type LoadedArt, type LoadedPack } from '../art/loader';
import { bodyScale, frameRect, type AnimationSpec, type FamilyKind, type Manifest } from '../art/manifest';
import { baseBar } from '../../lib/shooter-text';
import { PALETTE } from '../palette';
import { paintGround } from './background';
import { durationOf, fallbackFor, flashAlpha, frameAt, isMoving, moveRate } from './anim';
import { diffSnapshots, isAttacking, snapshotOf, type FrameEvents, type Snapshot } from './events';
import { PositionHistory } from './interpolate';
import { prefersReducedMotion } from './motion';
import { AMBIENT_COUNT, ambientSpeck, placeProps, type Ambient } from './props';
import { turnFor } from './rotation';

/** Depths: the ground is 0; everything of the world stays under the HUD (8 and up). */
const DEPTH = { ground: 0, pickup: 2, base: 3, enemy: 4, player: 5, weaponGun: 5.1, bullet: 5.5, fx: 6, ambient: 6.5, bars: 7 } as const;
const MAX_FX = 60;
const HAND = 10; // px in front of the hero's center where the gun's grip is held
const HURT_MS = 130;
const SHOOT_MS = 230;
const HIT_BASE_MS = 260;

/** A lighter shade of #rrggbb, for the enemies' bullets (so they are never mistaken for the player's). */
function lightHex(hex: string): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const c = (shift: number) => Math.min(255, Math.round(((v >> shift) & 255) * 1.35));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

const key = (kind: LoadedPack['kind'], id: string) => `pack:${packKey(kind, id)}`;
const frameName = (index: number, type?: EnemyType) => (type ? `${type}:${index}` : String(index));

/** Registers a loaded pack as a Phaser texture and cuts its frames, once per game (the textures outlive a restart). */
export function registerPack(textures: Phaser.Textures.TextureManager, pack: LoadedPack): void {
  const textureKey = key(pack.kind, pack.id);
  if (textures.exists(textureKey)) return;
  const texture = pack.source instanceof HTMLCanvasElement ? textures.addCanvas(textureKey, pack.source) : textures.addImage(textureKey, pack.source);
  if (!texture) return;
  const cut = (name: string, rect: { x: number; y: number; w: number; h: number }) => { if (!texture.has(name)) texture.add(name, 0, rect.x, rect.y, rect.w, rect.h); };
  const m = pack.manifest;
  if (m.frame && m.columns && m.animations) {
    const indexes = new Set<number>(Object.values(m.animations).flatMap((animation) => animation.frames));
    for (const index of indexes) cut(frameName(index), frameRect(m.frame, m.columns, index));
  }
  for (const [type, entry] of Object.entries(m.kinds ?? {})) {
    const indexes = new Set<number>(Object.values(entry.animations).flatMap((animation) => animation.frames));
    for (const index of indexes) cut(frameName(index, type as EnemyType), frameRect(entry.frame, entry.columns, index, entry.offset));
  }
}

interface Sheet { manifest: Manifest; textureKey: string }

interface EnemyView { img: Phaser.GameObjects.Image; flash: Phaser.GameObjects.Image; angle: number; hurtAt: number; born: number }
interface Fx { img: Phaser.GameObjects.Image; name: string; start: number; spec: AnimationSpec | undefined; textureKey: string; type?: EnemyType | undefined; fade: boolean; rotation: number; baseScale: number }

export interface WorldOptions { look: Look; reducedMotion?: boolean }

export class WorldRenderer {
  private readonly hero: Sheet;
  private readonly family: Sheet;
  private readonly base: Sheet;
  private readonly weapon: Sheet;
  private readonly pickupSheet: Sheet;
  private readonly fxSheet: Sheet;
  private readonly reduced: boolean;
  private readonly playerHistory = new PositionHistory();
  private readonly enemyHistory = new PositionHistory();
  private readonly bulletHistory = new PositionHistory();
  private readonly enemyBulletHistory = new PositionHistory();
  private readonly enemies = new Map<number, EnemyView>();
  private readonly bullets: Phaser.GameObjects.Image[] = [];
  private readonly enemyBullets: Phaser.GameObjects.Image[] = [];
  private readonly pickups: Phaser.GameObjects.Image[] = [];
  private readonly fx: Fx[] = [];
  private readonly specks: Phaser.GameObjects.Rectangle[] = [];
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly rings: Phaser.GameObjects.Graphics;
  private playerImg!: Phaser.GameObjects.Image;
  private playerFlash!: Phaser.GameObjects.Image;
  private gunImg!: Phaser.GameObjects.Image;
  private baseImg: Phaser.GameObjects.Image | undefined;
  private background!: Phaser.GameObjects.Image;
  private readonly ambient: Ambient;
  private readonly bulletStyle: 'dot' | 'streak';
  private previous: Snapshot | undefined;
  private now = 0;
  private playerAngle = 0;
  private playerHurtAt = -1e9;
  private shotAt = -1e9;
  private baseHitAt = -1e9;
  private lastMuzzle = { x: 0, y: 0 };

  constructor(private readonly scene: Phaser.Scene, private readonly level: ShooterLevel, art: LoadedArt, options: WorldOptions) {
    const sheetOf = (kind: LoadedPack['kind'], id: string): Sheet => {
      const pack = art.packs.get(packKey(kind, id));
      if (!pack) throw new Error(`pack ${kind}/${id} missing`);
      registerPack(scene.textures, pack);
      return { manifest: pack.manifest, textureKey: key(kind, id) };
    };
    const { look } = options;
    this.hero = sheetOf('hero', look.hero);
    this.family = sheetOf('family', look.family);
    this.base = sheetOf('base', look.base);
    this.weapon = sheetOf('weapon', look.weapon);
    this.pickupSheet = sheetOf('pickup', 'health');
    this.fxSheet = sheetOf('fx', 'basic');
    this.reduced = options.reducedMotion ?? prefersReducedMotion();
    const biome = art.packs.get(packKey('biome', look.biome));
    this.ambient = biome?.manifest.ambient ?? 'none';
    this.bulletStyle = this.weapon.manifest.bullet?.style ?? 'dot';
    this.bars = scene.add.graphics().setDepth(DEPTH.bars);
    this.rings = scene.add.graphics().setDepth(DEPTH.enemy + 0.5);
    if (biome) this.bakeGround(biome);
    this.makeBulletTextures();
    this.makePlayer();
    if (level.base) this.makeBase();
    for (let i = 0; i < AMBIENT_COUNT[this.ambient]; i += 1) this.specks.push(scene.add.rectangle(0, 0, 2, 2, 0xffffff, 0).setDepth(DEPTH.ambient));
  }

  // --- setup ---------------------------------------------------------------------------------------------------------------
  private bakeGround(biome: LoadedPack) {
    const { scene, level } = this;
    const groundKey = `ground:${key('biome', biome.id)}:${level.seed}:${level.obstacles.map((o) => `${o.x},${o.y},${o.width},${o.height}`).join('|')}`;
    if (!scene.textures.exists(groundKey)) {
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 540;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const props = placeProps(level, biome.manifest.props ?? []);
        const makeTile = (sheet: CanvasImageSource, x: number, y: number, w: number, h: number) => {
          const tile = document.createElement('canvas');
          tile.width = w; tile.height = h;
          tile.getContext('2d')?.drawImage(sheet, x, y, w, h, 0, 0, w, h);
          return tile;
        };
        paintGround(ctx, level, biome.manifest, biome.source, props, makeTile);
      }
      scene.textures.addCanvas(groundKey, canvas);
    }
    this.background = scene.add.image(0, 0, groundKey).setOrigin(0, 0).setDepth(DEPTH.ground);
  }

  /** The three bullet textures, painted in their colors once (a Canvas renderer is slow at tinting, so nothing is tinted at run time):
   * the player's round bullet, its long piercing streak, and the enemies' bullet (lighter, with a white rim). */
  private makeBulletTextures() {
    const { textures } = this.scene;
    const mine = this.weapon.manifest.bullet?.color ?? this.level.theme.bullet;
    const theirs = this.level.theme.enemy;
    this.dotKey = `bullet:dot:${mine}`; this.streakKey = `bullet:streak:${mine}`; this.enemyKey = `bullet:enemy:${theirs}`;
    const paint = (name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (textures.exists(name)) return;
      const canvasTexture = textures.createCanvas(name, w, h);
      const ctx = canvasTexture?.getContext();
      if (ctx) { draw(ctx); canvasTexture?.refresh(); }
    };
    paint(this.dotKey, 12, 12, (ctx) => { ctx.fillStyle = mine; ctx.beginPath(); ctx.arc(6, 6, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(6, 6, 2.2, 0, Math.PI * 2); ctx.fill(); });
    paint(this.streakKey, 28, 8, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 28, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, mine);
      ctx.fillStyle = g; ctx.fillRect(0, 2, 28, 4); ctx.fillStyle = '#ffffff'; ctx.fillRect(23, 3, 5, 2);
    });
    paint(this.enemyKey, 16, 16, (ctx) => {
      ctx.fillStyle = lightHex(theirs); ctx.beginPath(); ctx.arc(8, 8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(8, 8, 6.6, 0, Math.PI * 2); ctx.stroke();
    });
  }
  private dotKey = ''; private streakKey = ''; private enemyKey = '';

  private makePlayer() {
    const { scene } = this;
    const anchor = this.hero.manifest.anchor ?? { x: 0.5, y: 0.5 };
    this.playerImg = scene.add.image(0, 0, this.hero.textureKey, '0').setOrigin(anchor.x, anchor.y).setDepth(DEPTH.player);
    this.playerFlash = scene.add.image(0, 0, this.hero.textureKey, '0').setOrigin(anchor.x, anchor.y).setDepth(DEPTH.player + 0.05).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    const grip = this.weapon.manifest.anchor ?? { x: 0.3, y: 0.5 };
    this.gunImg = scene.add.image(0, 0, this.weapon.textureKey, '0').setOrigin(grip.x, grip.y).setDepth(DEPTH.weaponGun);
  }

  private makeBase() {
    const anchor = this.base.manifest.anchor ?? { x: 0.5, y: 0.5 };
    this.baseImg = this.scene.add.image(0, 0, this.base.textureKey, '0').setOrigin(anchor.x, anchor.y).setDepth(DEPTH.base);
  }

  // --- the loop ------------------------------------------------------------------------------------------------------------
  /** Call after every simulated tick: remembers where everything is, for the smoothing. */
  tick(state: ShooterState): void {
    this.playerHistory.push([{ id: 0, x: state.player.x, y: state.player.y }]);
    this.enemyHistory.push(state.enemies);
    this.bulletHistory.push(state.bullets);
    this.enemyBulletHistory.push(state.enemyBullets);
  }

  /** Draws one frame. `alpha` is how far through the current tick the frame is (0..1); `deltaMs` is the real time since the last frame. */
  render(state: ShooterState, alpha: number, deltaMs: number): void {
    this.now += deltaMs;
    const after = snapshotOf(state);
    const events = this.previous ? diffSnapshots(this.previous, after, this.level.weapon.range) : undefined;
    this.previous = after;
    if (events) this.react(events, state);
    this.drawPlayer(state, alpha, deltaMs);
    this.drawEnemies(state, alpha, deltaMs);
    this.drawBullets(state, alpha);
    this.drawPickups(state);
    this.drawBase(state);
    this.updateFx();
    this.drawAmbient();
  }

  /** How long the scene should keep drawing after the game ends before it shows the result (ms): the base falls, the hero drops. */
  endingMs(state: ShooterState): number {
    if (state.status !== 'lost') return 0;
    return state.lostBy === 'base' && this.base.manifest.animations?.destroyed ? 800 : this.reduced ? 0 : 500;
  }

  dispose(): void {
    for (const view of this.enemies.values()) { view.img.destroy(); view.flash.destroy(); }
    this.enemies.clear();
    for (const group of [this.bullets, this.enemyBullets, this.pickups]) { for (const img of group) img.destroy(); group.length = 0; }
    for (const effect of this.fx) effect.img.destroy();
    this.fx.length = 0;
    for (const speck of this.specks) speck.destroy();
    this.specks.length = 0;
    this.playerImg?.destroy(); this.playerFlash?.destroy(); this.gunImg?.destroy(); this.baseImg?.destroy(); this.background?.destroy();
    this.bars.destroy(); this.rings.destroy();
  }

  // --- reacting to what changed -----------------------------------------------------------------------------------------------
  private react(events: FrameEvents, state: ShooterState): void {
    const shake = (duration: number, intensity: number) => { if (!this.reduced) this.scene.cameras.main.shake(duration, intensity); };
    if (events.playerHit) { this.playerHurtAt = this.now; shake(120, 0.004); }
    if (events.baseHit) { this.baseHitAt = this.now; shake(90, 0.0025); if (state.base) this.spawnFx('spark', state.base.x, state.base.y - 8, { scale: 1.4 }); }
    if (events.shot) {
      this.shotAt = this.now;
      this.spawnFx('muzzle', this.lastMuzzle.x, this.lastMuzzle.y, { rotation: this.playerAngle, scale: this.heroScale() });
    }
    for (const id of events.hurt) {
      const view = this.enemies.get(id);
      if (view) view.hurtAt = this.now;
    }
    for (const impact of events.impacts) this.spawnFx('spark', impact.x, impact.y, {});
    for (const death of events.deaths) {
      const view = this.enemies.get(death.id);
      const angle = view?.angle ?? 0;
      this.spawnDeath(death.type, death.x, death.y, angle, death.boss);
      if (death.boss) shake(450, 0.01);
    }
  }

  // --- the pieces -------------------------------------------------------------------------------------------------------------
  private anim(sheet: Sheet, name: string, type?: EnemyType): AnimationSpec | undefined {
    const animations = type ? sheet.manifest.kinds?.[type]?.animations : sheet.manifest.animations;
    return animations?.[name];
  }

  private heroScale(): number {
    return bodyScale(this.hero.manifest.body, PLAYER_RADIUS);
  }

  private drawPlayer(state: ShooterState, alpha: number, deltaMs: number): void {
    const { player } = state;
    const point = this.playerHistory.at(0, alpha) ?? player;
    const before = this.playerHistory.previous(0);
    const now = this.playerHistory.at(0, 1);
    const speed = before && now ? Math.sqrt((now.x - before.x) ** 2 + (now.y - before.y) ** 2) * TICK_RATE : 0;
    this.playerAngle = turnFor(this.playerAngle, player.aim, deltaMs, 16);
    const aim = this.playerAngle;
    const ux = Math.cos(aim);
    const uy = Math.sin(aim);
    const sinceShot = this.now - this.shotAt;
    const recoil = this.reduced ? 0 : Math.max(0, 1 - sinceShot / 90) * 2;
    const x = point.x - ux * recoil;
    const y = point.y - uy * recoil;
    const scale = this.heroScale();
    const lost = state.status === 'lost';
    const protectedNow = !lost && state.tick < player.invulnerableUntilTick && Math.floor(state.tick / 5) % 2 === 0;
    const sheet = this.hero;
    let name = isMoving(speed) ? 'move' : 'idle';
    let since = this.now;
    if (lost) { name = 'die'; since = this.now - this.endStart(); }
    else if (sinceShot < SHOOT_MS && this.anim(sheet, 'shoot')) { name = 'shoot'; since = sinceShot; }
    else if (this.now - this.playerHurtAt < HURT_MS && this.anim(sheet, 'hit')) { name = 'hit'; since = this.now - this.playerHurtAt; }
    const spec = this.anim(sheet, name) ?? this.anim(sheet, fallbackFor(name).use ?? 'move');
    const rate = name === 'move' ? moveRate(speed, state.level.player.speed) : 1;
    const index = spec ? (name === 'idle' && !this.anim(sheet, 'idle') ? spec.frames[0]! : frameAt(spec, since * rate)) : 0;
    this.playerImg.setFrame(frameName(index)).setPosition(x, y).setRotation(aim).setScale(scale).setAlpha(protectedNow ? 0.35 : 1);
    const flashing = !this.reduced && !this.anim(sheet, 'hit') && this.now - this.playerHurtAt < 80;
    this.playerFlash.setVisible(flashing);
    if (flashing) this.playerFlash.setFrame(frameName(index)).setPosition(x, y).setRotation(aim).setScale(scale).setAlpha(flashAlpha(this.now - this.playerHurtAt));
    // the gun, held in front, kicking when it fires; its barrel end is where the muzzle flash appears
    const gm = this.weapon.manifest;
    const gunFrames = this.anim(this.weapon, sinceShot < 200 ? 'fire' : 'idle');
    const gunIndex = gunFrames ? frameAt(gunFrames, sinceShot < 200 ? sinceShot : this.now) : 0;
    const gx = x + ux * HAND * scale;
    const gy = y + uy * HAND * scale;
    this.gunImg.setFrame(frameName(gunIndex)).setPosition(gx, gy).setRotation(aim).setScale(scale).setAlpha(protectedNow ? 0.35 : 1).setVisible(!lost);
    const frameSize = gm.frame ?? { w: 40, h: 24 };
    const grip = gm.anchor ?? { x: 0.3, y: 0.5 };
    const muzzle = gm.muzzle ?? { x: frameSize.w, y: frameSize.h / 2 };
    const mx = (muzzle.x - grip.x * frameSize.w) * scale;
    const my = (muzzle.y - grip.y * frameSize.h) * scale;
    this.lastMuzzle = { x: gx + mx * ux - my * uy, y: gy + mx * uy + my * ux };
  }

  private endedAt = -1;
  private endStart(): number {
    if (this.endedAt < 0) this.endedAt = this.now;
    return this.endedAt;
  }

  private drawEnemies(state: ShooterState, alpha: number, deltaMs: number): void {
    this.rings.clear();
    this.bars.clear();
    const seen = new Set<number>();
    for (const enemy of state.enemies) {
      seen.add(enemy.id);
      let view = this.enemies.get(enemy.id);
      const spec = this.family.manifest.kinds?.[enemy.type];
      if (!spec) continue;
      if (!view) {
        const anchor = spec.anchor ?? { x: 0.5, y: 0.5 };
        view = {
          img: this.scene.add.image(enemy.x, enemy.y, this.family.textureKey, frameName(0, enemy.type)).setOrigin(anchor.x, anchor.y),
          flash: this.scene.add.image(enemy.x, enemy.y, this.family.textureKey, frameName(0, enemy.type)).setOrigin(anchor.x, anchor.y).setBlendMode(Phaser.BlendModes.ADD).setVisible(false),
          angle: 0, hurtAt: -1e9, born: this.now,
        };
        const first = this.enemyHistory.at(enemy.id, alpha) ?? enemy;
        view.angle = first.x < state.player.x ? 0 : Math.PI;
        this.enemies.set(enemy.id, view);
      }
      this.updateEnemy(view, enemy, spec, state, alpha, deltaMs);
    }
    for (const [id, view] of this.enemies) {
      if (seen.has(id)) continue;
      view.img.destroy(); view.flash.destroy(); this.enemies.delete(id);
    }
  }

  private updateEnemy(view: EnemyView, enemy: ShooterEnemy, spec: FamilyKind, state: ShooterState, alpha: number, deltaMs: number): void {
    const info = ENEMY_TYPES[enemy.type];
    const point = this.enemyHistory.at(enemy.id, alpha) ?? enemy;
    const before = this.enemyHistory.previous(enemy.id);
    const now = this.enemyHistory.at(enemy.id, 1) ?? enemy;
    const dx = before ? now.x - before.x : 0;
    const dy = before ? now.y - before.y : 0;
    const speed = Math.sqrt(dx * dx + dy * dy) * TICK_RATE;
    const attacking = isAttacking(enemy, state);
    const shooter = rangedOf(enemy.type) !== undefined || enemy.type === 'gunner';
    let target = view.angle;
    if (attacking || shooter) {
      const tx = (attacking && state.base && enemy.aimAtBase ? state.base.x : state.player.x) - point.x;
      const ty = (attacking && state.base && enemy.aimAtBase ? state.base.y : state.player.y) - point.y;
      if (tx !== 0 || ty !== 0) target = Math.atan2(ty, tx);
    } else if (speed > 1) target = Math.atan2(dy, dx);
    view.angle = turnFor(view.angle, target, deltaMs, isBoss(enemy.type) ? 4 : 9);
    const scale = bodyScale(spec.body, info.radius);
    let name = attacking ? 'attack' : isMoving(speed) ? 'move' : 'idle';
    let since = this.now - view.born;
    const hurtFor = this.now - view.hurtAt;
    const hasHit = spec.animations.hit !== undefined;
    if (hurtFor < HURT_MS && hasHit) { name = 'hit'; since = hurtFor; }
    const animation = spec.animations[name] ?? spec.animations[fallbackFor(name).use ?? 'move'];
    const rate = name === 'move' ? moveRate(speed, info.speed) : 1;
    const index = animation ? (name === 'idle' && !spec.animations.idle ? animation.frames[0]! : frameAt(animation, since * rate)) : 0;
    const frame = frameName(index, enemy.type);
    view.img.setFrame(frame).setPosition(point.x, point.y).setRotation(view.angle).setScale(scale).setDepth(DEPTH.enemy + point.y / 10_000);
    const flash = !this.reduced && !hasHit && hurtFor < 80;
    view.flash.setVisible(flash);
    if (flash) view.flash.setFrame(frame).setPosition(point.x, point.y).setRotation(view.angle).setScale(scale).setDepth(DEPTH.enemy + point.y / 10_000 + 0.00001).setAlpha(flashAlpha(hurtFor));
    // a boss shows what it is about to do: a pulsing ring while it warns of its rush, a ring in red once it is enraged
    if (enemy.bossPhase === 'telegraph' && Math.floor(state.tick / 6) % 2 === 0) this.rings.lineStyle(4, PALETTE.white, 0.9).strokeCircle(point.x, point.y, info.radius + 12);
    // hit points: a small bar above an enemy that has lost some
    const max = enemy.maxHp ?? info.hp;
    if (enemy.hp < max && enemy.hp > 0) {
      const w = Math.max(18, info.radius * 2);
      const top = point.y - info.radius - (isBoss(enemy.type) ? 14 : 9);
      this.bars.fillStyle(PALETTE.ink, 0.8).fillRect(point.x - w / 2 - 1, top - 1, w + 2, 5);
      this.bars.fillStyle(enemy.hp / max < 0.34 ? PALETTE.danger : PALETTE.heal, 1).fillRect(point.x - w / 2, top, w * (enemy.hp / max), 3);
    }
  }

  private pooled(group: Phaser.GameObjects.Image[], index: number, textureKey: string, depth: number): Phaser.GameObjects.Image {
    let img = group[index];
    if (!img) { img = this.scene.add.image(0, 0, textureKey).setDepth(depth); group[index] = img; }
    return img;
  }

  private drawBullets(state: ShooterState, alpha: number): void {
    state.bullets.forEach((bullet, index) => {
      const p = this.bulletHistory.at(bullet.id, alpha) ?? bullet;
      const streak = this.bulletStyle === 'streak' || bullet.pierceLeft !== undefined;
      const img = this.pooled(this.bullets, index, this.dotKey, DEPTH.bullet);
      img.setTexture(streak ? this.streakKey : this.dotKey).setVisible(true).setPosition(p.x, p.y);
      if (streak) img.setOrigin(1, 0.5).setRotation(Math.atan2(bullet.vy, bullet.vx)).setScale(1);
      else img.setOrigin(0.5, 0.5).setRotation(0).setScale((BULLET_RADIUS * 2) / 12);
    });
    for (let i = state.bullets.length; i < this.bullets.length; i += 1) this.bullets[i]?.setVisible(false);
    state.enemyBullets.forEach((bullet, index) => {
      const p = this.enemyBulletHistory.at(bullet.id, alpha) ?? bullet;
      const img = this.pooled(this.enemyBullets, index, this.enemyKey, DEPTH.bullet);
      img.setVisible(true).setPosition(p.x, p.y).setScale((bullet.radius * 2) / 14);
    });
    for (let i = state.enemyBullets.length; i < this.enemyBullets.length; i += 1) this.enemyBullets[i]?.setVisible(false);
  }

  private drawPickups(state: ShooterState): void {
    const sheet = this.pickupSheet;
    const spec = this.anim(sheet, 'idle');
    const scale = bodyScale(sheet.manifest.body, 10);
    state.pickups.forEach((pickup, index) => {
      const img = this.pooled(this.pickups, index, sheet.textureKey, DEPTH.pickup);
      const blinking = pickup.expiresTick - state.tick < 180 && Math.floor(state.tick / 8) % 2 === 0;
      const anchor = sheet.manifest.anchor ?? { x: 0.5, y: 0.5 };
      img.setFrame(frameName(spec ? frameAt(spec, this.now) : 0)).setOrigin(anchor.x, anchor.y).setVisible(true).setPosition(pickup.x, pickup.y).setScale(scale).setAlpha(blinking ? 0.3 : 1);
    });
    for (let i = state.pickups.length; i < this.pickups.length; i += 1) this.pickups[i]?.setVisible(false);
  }

  private drawBase(state: ShooterState): void {
    const { base } = state;
    const img = this.baseImg;
    if (!base || !img) return;
    const sheet = this.base;
    const scale = bodyScale(sheet.manifest.body, BASE_SIZE);
    const bar = baseBar(base.hp, base.maxHp);
    let name = 'idle';
    let since = this.now;
    if (base.hp <= 0) { name = 'destroyed'; since = this.now - this.endStart(); }
    else if (this.now - this.baseHitAt < HIT_BASE_MS && this.anim(sheet, 'hit')) { name = 'hit'; since = this.now - this.baseHitAt; }
    else if (bar.low && this.anim(sheet, 'low')) name = 'low';
    const spec = this.anim(sheet, name) ?? this.anim(sheet, 'idle');
    const index = spec ? frameAt(spec, since) : 0;
    img.setFrame(frameName(index)).setPosition(base.x, base.y).setScale(scale);
  }

  // --- effects --------------------------------------------------------------------------------------------------------------------
  /** An effect from the effects pack (muzzle flash, spark, smoke, puff, burst) at a place. Skipped when 60 are already on screen. */
  private spawnFx(name: string, x: number, y: number, opts: { rotation?: number; scale?: number }): void {
    const spec = this.anim(this.fxSheet, name);
    if (!spec) return;
    this.addFx({ name, x, y, spec, textureKey: this.fxSheet.textureKey, rotation: opts.rotation ?? 0, scale: opts.scale ?? 1, fade: false });
  }

  /** An enemy dies: its `die` animation plays where it stood (or, with no such animation, it shrinks and fades), with a puff. */
  private spawnDeath(type: EnemyType, x: number, y: number, angle: number, boss: boolean): void {
    const spec = this.family.manifest.kinds?.[type];
    if (!spec) return;
    const info = ENEMY_TYPES[type];
    const die = spec.animations.die;
    this.addFx({
      name: 'die', x, y, spec: die, textureKey: this.family.textureKey, type, rotation: angle, scale: bodyScale(spec.body, info.radius), fade: die === undefined,
      anchor: spec.anchor,
    });
    this.spawnFx(boss ? 'burst' : 'puff', x, y, { scale: boss ? 2.4 : Math.max(0.8, info.radius / 14) });
    if (boss) for (const [ox, oy] of [[-26, -14], [24, 10], [-8, 26]] as const) this.spawnFx('puff', x + ox, y + oy, { scale: 1.6 });
  }

  private addFx(input: { name: string; x: number; y: number; spec: AnimationSpec | undefined; textureKey: string; type?: EnemyType | undefined; rotation: number; scale: number; fade: boolean; anchor?: { x: number; y: number } | undefined }): void {
    let slot = this.fx.find((fx) => !fx.img.visible);
    if (!slot) {
      if (this.fx.length >= MAX_FX) return;
      const img = this.scene.add.image(0, 0, input.textureKey, '0').setDepth(DEPTH.fx);
      slot = { img, name: '', start: 0, spec: undefined, textureKey: '', fade: false, rotation: 0, baseScale: 1 };
      this.fx.push(slot);
    }
    const anchor = input.anchor ?? { x: 0.5, y: 0.5 };
    const first = input.spec ? frameName(input.spec.frames[0]!, input.type) : '__BASE';
    slot.img.setTexture(input.textureKey, first).setOrigin(anchor.x, anchor.y).setPosition(input.x, input.y).setRotation(input.rotation).setScale(input.scale).setAlpha(1).setVisible(true);
    slot.name = input.name; slot.start = this.now; slot.spec = input.spec; slot.textureKey = input.textureKey; slot.type = input.type; slot.fade = input.fade; slot.rotation = input.rotation; slot.baseScale = input.scale;
  }

  private updateFx(): void {
    for (const fx of this.fx) {
      if (!fx.img.visible) continue;
      const age = this.now - fx.start;
      if (fx.spec) {
        if (age >= durationOf(fx.spec) + 120) { fx.img.setVisible(false); continue; }
        fx.img.setFrame(frameName(frameAt(fx.spec, age), fx.type));
        if (fx.name === 'die') fx.img.setAlpha(age > durationOf(fx.spec) ? Math.max(0, 1 - (age - durationOf(fx.spec)) / 120) : 1);
      } else {
        // no `die` animation: shrink and fade over 0.4 s
        const t = Math.min(1, age / 400);
        fx.img.setScale(fx.baseScale * (1 - 0.6 * t)).setAlpha(1 - t);
        if (t >= 1) fx.img.setVisible(false);
      }
    }
  }

  private drawAmbient(): void {
    if (this.ambient === 'none') return;
    this.specks.forEach((speck, index) => {
      const s = ambientSpeck(this.ambient, index, this.reduced ? 0 : this.now, this.level.seed);
      const light = this.ambient === 'snow' ? 0xffffff : this.ambient === 'fireflies' ? 0xf0ff80 : this.ambient === 'sparks' ? 0x9be8ff : 0xe6d2a0;
      speck.setPosition(s.x, s.y).setSize(s.size, s.size).setFillStyle(light, s.alpha);
    });
  }
}
