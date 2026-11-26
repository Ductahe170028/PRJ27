import { Gamepad2, ArrowUpRight } from 'lucide-react';

/** The empty stage, before the first game. */
export function EmptyPreview({ hint = 'để dựng màn bắn quái đầu tiên.', tag = 'Top-down Shooter' }: { hint?: string; tag?: string }) {
  return <div className="empty-preview">
    <svg className="preview-art" viewBox="0 0 960 540" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x2="0" y2="1"><stop stopColor="#162237"/><stop offset="1" stopColor="#111b27"/></linearGradient>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#446179" strokeOpacity=".13"/></pattern>
      </defs>
      <path fill="url(#sky)" d="M0 0h960v540H0z"/>
      {Array.from({ length: 44 }, (_, i) => <rect key={i} x={(i * 173 + 41) % 960} y={(i * 79 + 17) % 390} width="2" height="2" fill="#92a9c1" opacity={i % 3 === 0 ? 0.5 : 0.2} />)}
      <circle cx="752" cy="123" r="72" fill="#a4bbc8" opacity=".03"/>
      <circle cx="752" cy="123" r="54" fill="#a4bbc8" opacity=".04"/>
      <circle cx="752" cy="123" r="36" fill="#9fb6c1" opacity=".35"/>
      <path d="M0 540V330h80v-42h76v54h70v-24h68v60h90v-32h82v49h90v-42h80v-32h76v46h80v-63h80v32h88v204z" fill="#203147" opacity=".6"/>
      <path d="M0 540V420h123v23h160v-38h90v57h172v-39h120v20h150v-42h145v139z" fill="#142333"/>
      <path fill="url(#grid)" d="M0 380h960v160H0z"/>
      <g fill="#2b414d"><path d="M0 504h960v36H0zM185 398h150v22H185zM392 308h140v22H392zM594 234h160v22H594zM804 154h120v22H804z"/></g>
      <g fill="#72a8ab" opacity=".55"><path d="M0 500h960v4H0zM185 394h150v4H185zM392 304h140v4H392zM594 230h160v4H594zM804 150h120v4H804z"/></g>
      <path fill="#c5f277" opacity=".4" d="M82 464h28v27H82zM84 491h8v7h-8zM100 491h8v7h-8z"/>
      <path fill="#172c31" d="M87 473h18v8H87z"/>
    </svg>
    <div className="empty-preview-shade"/>
    <div className="empty-preview-content">
      <div className="empty-game-icon"><Gamepad2 size={29} strokeWidth={1.4}/></div>
      <span className="eyebrow">MỘT Ý TƯỞNG. MỘT KHỞI ĐẦU.</span>
      <h3>Sân chơi đang chờ bạn.</h3>
      <p>Nhập mô tả và nhấn Generate Game<br/>{hint}</p>
      <div className="empty-preview-tag"><span className="small-dot"/> {tag} <ArrowUpRight size={13}/></div>
    </div>
    <span className="preview-watermark">YOUR NEXT WORLD STARTS HERE</span>
  </div>;
}
