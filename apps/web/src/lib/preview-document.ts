// Only trusted, local asset URLs and a random session ID enter this document.
// User input and API data are sent separately using validated postMessage data.
function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function createPreviewDocument(sessionId: string) {
  const runtimeUrl = new URL(`${import.meta.env.BASE_URL}runtime/game.js`, window.location.origin).href;
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${sessionId}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101b30;color:#a6bbce;font-family:system-ui,sans-serif}
    #game{width:100%;height:100%}canvas{display:block;outline:none;image-rendering:pixelated}
    canvas:focus-visible{outline:2px solid #c5f277;outline-offset:-2px}
    #runtime-status{position:absolute;inset:45% 20px auto;text-align:center;font-size:14px;pointer-events:none}
    #touch-controls{display:none;position:absolute;bottom:14px;left:16px;right:16px;justify-content:space-between;pointer-events:none}
    .directions{display:flex;gap:8px}button{pointer-events:auto;touch-action:none;user-select:none;border:1px solid #9ab1c755;background:#122234c9;color:#d9e6ef;border-radius:10px;width:48px;height:44px;font-size:20px}
    button:active{background:#344b53}button:focus-visible{outline:2px solid #c5f277}
    [hidden]{display:none!important}
    #game-hud{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    #game-result{position:absolute;inset:0;display:grid;place-content:center;text-align:center;background:#060d18d9;color:#e7eff8;gap:12px}
    #game-result h2,#game-result p{margin:0}#game-result button{width:auto;margin:0 auto;padding:0 20px;font-size:14px}
    @media(pointer:coarse){#touch-controls{display:flex}}
  </style>
  <script id="game-runtime" nonce="${sessionId}" data-session-id="${sessionId}" data-parent-origin="${escapeAttribute(window.location.origin)}" src="${escapeAttribute(runtimeUrl)}" defer></script>
</head>
<body>
  <div id="game"></div>
  <p id="runtime-status" role="status">Đang tải game…</p>
  <p id="game-hud" role="status" aria-label="Trạng thái màn chơi" hidden></p>
  <div id="touch-controls" aria-label="Điều khiển cảm ứng">
    <div class="directions"><button id="move-left" aria-label="Di chuyển trái">←</button><button id="move-right" aria-label="Di chuyển phải">→</button><button id="move-up" aria-label="Di chuyển lên" hidden>↑</button><button id="move-down" aria-label="Di chuyển xuống" hidden>↓</button></div>
    <button id="jump" aria-label="Nhảy">↑</button>
  </div>
  <div id="game-result" role="dialog" aria-labelledby="result-title" hidden>
    <h2 id="result-title"></h2><p id="result-detail"></p><button id="restart-game">Chơi lại (R)</button>
  </div>
</body>
</html>`;
}
