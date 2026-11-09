import { expect, it } from 'vitest';
import type { GamePlan } from '@game-creator/contracts';
import { controlMapping } from '../src/agent/control-mapping.js';
import { paddlePlan, shooterPlan } from './agent-fixtures.js';

const plan = (movement: GamePlan['movement'], action: GamePlan['action'], mechanics: string[], objective = 'Hoàn thành mục tiêu.'): GamePlan => ({
  title: 'Fixture', summary: 'Mô tả ngắn cho plan kiểm thử điều khiển.', mechanics, movement, action, objective,
});

const FLAPPY = 'Tạo game Flappy Bird 2D. Nhấn Space hoặc click để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Vượt qua mỗi cặp ống được 1 điểm. Va chạm với ống hoặc biên màn hình thì thua. Đạt 10 điểm thì thắng. Có nút Restart.';

it('maps a flap prompt from its words, including click, and does not invent arrow keys', () => {
  expect(controlMapping(plan('free', 'space', ['Space hoặc click để bay lên', 'Ống di chuyển liên tục']), FLAPPY)).toEqual({
    axis: 'none', actions: ['space', 'pointer'], lift: true, autonomous: true, lossOnContact: true, pickup: false,
  });
  expect(controlMapping(plan('vertical', 'space', ['Nhấn Space hoặc click để chim bật lên', 'Ống di chuyển từ phải sang trái']), FLAPPY).axis).toBe('none');
  const refused = 'Tạo game Flappy Bird 2D. Nhấn Space hoặc click chuột trái để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Không yêu cầu phím R hoặc phím mũi tên. Va chạm với ống thì thua.';
  const mapped = controlMapping(plan('horizontal', 'space', ['Space or left click makes bird flap upward', 'Pipes move left continuously', 'Gravity pulls bird down'], 'Survive by passing pipe pairs.'), refused);
  expect(mapped).toMatchObject({ axis: 'none', actions: ['space', 'pointer'], lift: true, autonomous: true, lossOnContact: true });
});

it('does not read the game title when the same words ask for arrows', () => {
  const arrows = controlMapping({ ...plan('free', 'none', ['Đi trái', 'Đi phải']), title: 'Flappy Bird' }, 'Di chuyển trái phải bằng phím mũi tên.');
  const flap = controlMapping({ ...plan('free', 'space', ['Bay lên', 'Có trọng lực']), title: 'Flappy Bird' }, 'Space hoặc click để chim bay lên, có trọng lực. Ống di chuyển từ phải sang trái.');
  expect(arrows.axis).toBe('horizontal');
  expect(flap.axis).toBe('none');
  expect(flap.actions).toEqual(['space', 'pointer']);
});

it('maps the five genre requirements without using a title or a default arrow axis', () => {
  expect(controlMapping(plan('horizontal', 'space', ['Chạy', 'Nhảy']), 'Di chuyển trái phải bằng phím mũi tên. Space để nhảy. Có trọng lực. Thu thập xu.')).toMatchObject({
    axis: 'horizontal', actions: ['space'], lift: true, pickup: true, autonomous: false,
  });
  expect(controlMapping(plan('free', 'none', ['Đi bốn hướng', 'Tránh kẻ địch']), 'Di chuyển bốn hướng bằng phím mũi tên. Thu thập vật phẩm. Chạm kẻ địch thì thua.')).toMatchObject({
    axis: 'free', actions: [], lift: false, lossOnContact: true, pickup: true,
  });
  expect(controlMapping(shooterPlan, 'Di chuyển trái phải bằng phím mũi tên. Space bắn đạn lên trên.')).toMatchObject({
    axis: 'horizontal', actions: ['space'], lift: false, autonomous: false, lossOnContact: false,
  });
  expect(controlMapping(paddlePlan, 'Bóng tự di chuyển và nảy. Thanh đỡ di chuyển trái phải bằng phím mũi tên.')).toMatchObject({
    axis: 'horizontal', actions: [], autonomous: true, lift: false,
  });
  expect(controlMapping(plan('none', 'none', ['Đi', 'Dừng']), 'Dùng phím mũi tên để đi.')).toMatchObject({ axis: 'free', actions: [] });
});
