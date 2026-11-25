import { Gamepad2 } from 'lucide-react';
import type { LevelInfo } from '../lib/shooter-text';

/** The "Thông tin màn" card: goal, health, most enemies, weapon, and the extra lines (shooting enemies, health
 * drops). Everything comes from `levelInfo(level)`, so it cannot disagree with the game that is played. */
export function LevelInfoCard({ info }: { info: LevelInfo }) {
  return <section className="panel status-panel shooter-info" aria-label="Thông tin màn">
    <div className="status-heading"><Gamepad2 size={14}/><h2>Thông tin màn</h2></div>
    <dl>
      <div><dt>Mục tiêu</dt><dd data-info="goal">{info.goal}</dd></div>
      <div><dt>Máu tối đa</dt><dd data-info="health">{info.maxHealth}</dd></div>
      <div><dt>Quái tối đa</dt><dd data-info="enemies">{info.maxEnemies}</dd></div>
      <div><dt>Súng</dt><dd data-info="weapon">{info.weapon}<small>{info.weaponDetail}</small></dd></div>
    </dl>
    {info.extras.length > 0 && <ul className="shooter-extras" aria-label="Điểm đặc biệt của màn">
      {info.extras.map((extra) => <li key={extra} data-info="extra">{extra}</li>)}
    </ul>}
  </section>;
}
