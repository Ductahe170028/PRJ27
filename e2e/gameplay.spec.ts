import { test, expect } from '@playwright/test';
import type { GamePlan } from '@game-creator/contracts';
import { CodeValidator } from '../apps/api/src/agent/code-validator.js';
import { PlaywrightGameTester } from '../apps/api/src/agent/game-tester.js';
import { shooterPlan, shooterSource } from '../apps/api/test/agent-fixtures.js';

// Mutations compile and boot successfully. Only behavioral tests can reject them.
test('gameplay rejects placed/stationary bullets even though the game boots and Space changes the image', async () => {
  const source = shooterSource.replace('e.y -= 480 * dt;', 'e.vy = -480;');
  const compiled = new CodeValidator().validate(source);
  expect(compiled.errors).toEqual([]);
  const result = await new PlaywrightGameTester().test(compiled.javascript!, shooterPlan, new AbortController().signal, 'Space bắn đạn lên trên');
  expect(result.errors.join()).toContain('continuous forward flight');
});

test('gameplay rejects motion that happens only while the fire button is held', async () => {
  const source = shooterSource.replace('e.y -= 480 * dt;', 'if (api.input.action) { e.y -= 480 * dt; }');
  const compiled = new CodeValidator().validate(source);
  expect(compiled.errors).toEqual([]);
  const result = await new PlaywrightGameTester().test(compiled.javascript!, shooterPlan, new AbortController().signal);
  expect(result.errors.join()).toContain('continuous forward flight');
});

const plan: GamePlan = { title: 'Orb Launcher', summary: 'A launcher hits a target.', mechanics: ['Shoot to the right', 'Hit targets to damage them'], movement: 'none', action: 'space', objective: 'Damage the target to win.' };
function launcher(options: { damage?: boolean; cleanup?: boolean; centered?: boolean; direction?: number; pointer?: boolean } = {}) {
  const { damage = true, cleanup = true, centered = false, direction = 1, pointer = false } = options;
  return `function create(api: GameAPI): void {
    const p=api.spawn('orb',200,280,30,30,123); api.setPlayer(p); api.state.player=p.id; api.state.cooldown=0;
    api.spawn('obstacle',800,350,25,25,456); api.status('Launch to damage the target.');
  }
  function update(api: GameAPI,dt: number): void {
    const p=api.get(api.state.player ?? 0); if(!p){return;}
    api.state.cooldown=(api.state.cooldown ?? 0)-dt;
    if(api.input.${pointer ? 'pointerDown' : 'action'} && (api.state.cooldown ?? 0)<=0){api.spawn('spark',p.x+${centered ? 0 : 23},p.y,10,6,789);api.state.cooldown=0.2;}
    for(const e of api.entities){
      if(e.kind==='spark'){
        e.x+=${direction * 360}*dt;
        ${cleanup ? 'if(e.x>1000 || e.x<0){api.remove(e);continue;}' : ''}
        for(const target of api.entities){if(target.kind==='obstacle' && api.overlaps(e,target)){
          ${damage ? 'target.hp-=1;if(target.hp<=0){api.remove(target);api.addScore(10);}' : ''}
          api.remove(e); break;
        }}
      }
    }
  }`;
}
for (const [label, options, expected] of [
  ['correct horizontal shooting', {}, ''],
  ['no hit damage', { damage: false }, 'did not damage'],
  ['missing edge cleanup', { cleanup: false }, 'remove offscreen'],
  ['center launch', { centered: true }, 'front edge'],
  ['wrong firing direction', { direction: -1 }, 'continuous forward flight'],
  ['pointer shooting', { pointer: true }, ''],
] as const) {
  test(`requirements-based gameplay: ${label}`, async () => {
    const compiled = new CodeValidator().validate(launcher(options));
    expect(compiled.errors).toEqual([]);
    const result = await new PlaywrightGameTester().test(compiled.javascript!, { ...plan, action: 'pointer' in options ? 'pointer' : 'space' }, new AbortController().signal, 'Shoot to the right');
    if (expected) expect(result.errors.join()).toContain(expected);
    else expect(result.errors).toEqual([]);
  });
}
