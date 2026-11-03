import { expect, it } from 'vitest';
import { projectileRequirement } from '../src/agent/gameplay-requirements.js';
import { checkProjectileFlight, firingDirection } from '../src/agent/projectile-checks.js';
import { paddlePlan, shooterPlan } from './agent-fixtures.js';
import type { ProbeBirth } from '../src/agent/gameplay-probe.js';

it.each([
  ['Space bắn đạn lên trên. Kẻ địch bay xuống dưới.', { x: 0, y: -1 }],
  ['Shoot to the right. Move up and down.', { x: 1, y: 0 }],
  ['Bắn đạn sang trái.', { x: -1, y: 0 }],
  ['Fire bullets downward.', { x: 0, y: 1 }],
  ['Phím lên trên và xuống dưới di chuyển, Space bắn đạn sang phải. Kẻ địch sang trái.', { x: 1, y: 0 }],
  ['Move up and down, shoot to the right.', { x: 1, y: 0 }],
])('derives shooting direction from the original requirement: %s', (request, direction) => {
  expect(projectileRequirement(shooterPlan, request)?.direction).toEqual(direction);
});
it('does not reinterpret bouncing balls, jumping or placing mines as shooting', () => {
  expect(projectileRequirement(paddlePlan, 'Đỡ bóng và phá gạch')).toBeUndefined();
  expect(projectileRequirement({ ...paddlePlan, mechanics: ['Space đặt bom đứng yên', 'Nhảy qua hố'] }, 'Đặt bẫy')).toBeUndefined();
});
it('recognizes pointer shooting without assuming a game title, axis or entity kind', () => {
  expect(projectileRequirement({ ...paddlePlan, action: 'pointer' }, 'Shoot toward the pointer')).toEqual({ pointer: true });
});
const birth: ProbeBirth = { id: 7, time: 1, x: 400, y: 267, width: 6, height: 10, hp: 1, alive: true,
  player: { id: 2, x: 400, y: 290, width: 30, height: 30, hp: 1, alive: true } };
it('rejects stationary shots, wrong-way motion, disappearing shots and spawning inside the player', () => {
  const direction = { x: 0, y: -1 };
  expect(checkProjectileFlight(birth, birth, direction).join()).toContain('continuous forward flight');
  expect(checkProjectileFlight(birth, { ...birth, y: 300 }, direction)).not.toEqual([]);
  expect(checkProjectileFlight(birth, undefined, direction)).not.toEqual([]);
  expect(checkProjectileFlight({ ...birth, y: 290 }, { ...birth, y: 200 }, direction).join()).toContain('front edge');
  expect(checkProjectileFlight(birth, { ...birth, y: 180 }, direction)).toEqual([]);
});
it('infers forward/pointer vectors without fixing the shooter to the bottom of the screen', () => {
  expect(firingDirection(birth, { pointer: false }, { x: 800, y: 290 })).toEqual({ x: 0, y: -1 });
  expect(firingDirection(birth, { pointer: true }, { x: 800, y: 290 })).toEqual({ x: 1, y: 0 });
});
