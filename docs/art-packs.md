# Gói ảnh (art pack): cách làm ảnh cho game

Tài liệu này dành cho người làm ảnh (họa sĩ, hoặc người dùng công cụ AI tạo ảnh). Bạn **không cần biết lập trình**: chỉ cần làm ảnh đúng kích thước, đặt đúng tên thư mục và viết một tệp `manifest.json` nhỏ. Game sẽ tự co giãn, xoay và chạy hoạt ảnh. Nếu thiếu ảnh hoặc ảnh lỗi, game tự dùng ảnh tạm do code vẽ, nên **không bao giờ hỏng vì thiếu ảnh**.

## 1. Khái niệm

Một **gói** là một thư mục:

```
apps/web/public/art/<loại>/<id>/
  manifest.json     (bắt buộc: mô tả ảnh)
  sheet.png         (ảnh: nhiều khung xếp thành lưới)
```

- `<loại>` là một trong: `biome` (phong cảnh), `hero` (nhân vật), `family` (họ quái), `base` (căn cứ), `weapon` (súng cầm tay), `pickup` (vật phẩm), `fx` (hiệu ứng).
- `<id>` chỉ gồm chữ thường, số và dấu gạch ngang, dài tối đa 30 ký tự (ví dụ `scout`, `ice-base`, `grunt-test`).
- Một gói có thể do **code vẽ** (`"source": "procedural"`, không có `sheet.png`) hoặc là **ảnh PNG** (`"source": "png"`). **Gói PNG luôn được ưu tiên** hơn gói do code vẽ cùng loại và cùng id. Gói PNG thiếu hay lỗi thì game dùng gói do code vẽ.

## 2. Quy tắc chung cho mọi ảnh

- Định dạng **PNG, nền trong suốt**. Mỗi tấm tối đa **1,5 MB** (một game dùng tối đa 12 gói, tổng tối đa 6 MB).
- Mọi nhân vật, quái, súng **quay mặt sang phải (+x)** trong ảnh. Game tự xoay theo hướng đi hoặc hướng ngắm.
- Nhìn **từ trên xuống** (pixel art, 2D).
- Các khung xếp thành **lưới đều**, đếm từ trái sang phải rồi từ trên xuống dưới (khung số 0 ở góc trên trái). `frame` là kích thước một khung (px), `columns` là số khung mỗi hàng.
- **`body` (thân)** là kích thước phần "thân thật" trong khung, theo px của ảnh. Game **tự phóng to hay thu nhỏ** ảnh sao cho thân trùng khít với hộp va chạm của game: `tỉ lệ = bán kính va chạm / body.radius` (căn cứ: `BASE_SIZE / body.w`). Nhờ đó ảnh độ phân giải nào cũng khớp, và ảnh được phép **lớn hơn thân** (cánh, súng, tháp, bóng đổ).
- `anchor` (0 đến 1): điểm trong khung được đặt đúng vào tâm thân. Mặc định (0,5; 0,5) là giữa khung.
- Thiếu một hoạt ảnh thì dùng cách dự phòng: `hit` thành nháy trắng 80 ms; `die` thành co nhỏ rồi mờ dần kèm hạt; `attack` dùng `move`; `idle` dùng khung đầu của `move`.

### Bảng hoạt ảnh (tên chuẩn)

Mỗi hoạt ảnh: `{ "frames": [số khung...], "fps": 1 đến 30, "loop": true hoặc false }`.

| Loại | Tên hoạt ảnh |
|---|---|
| `hero` | `idle`, `move`, `shoot`, `hit`, `die` |
| `family` (mỗi loại quái) | `move`, `attack`, `hit`, `die` (tùy chọn `idle`) |
| `base` | `idle`, `hit`, `low` (máu thấp), `destroyed` |
| `weapon` | `idle`, `fire` |
| `pickup` | `idle` |
| `fx` | `muzzle` (tia lửa nòng), `spark` (đạn trúng), `smoke` (khói), `puff` (quái chết), `burst` (boss chết) |

## 3. Từng loại gói cần ảnh gì

### `hero` (nhân vật)

- Khung gợi ý **48×48**, `body.radius` **14** (bằng bán kính va chạm của người chơi, nên không bị co giãn).
- Vẽ **không cầm súng**: súng là gói `weapon` riêng, vẽ chồng lên.
- Số khung gợi ý: `idle` 2, `move` 6, `shoot` 3, `hit` 1, `die` 4.

### `family` (họ quái)

Một họ có đủ **6 loại quái** của game: `runner`, `brute`, `swarmer`, `spitter`, `crusher`, `gunner`. Mỗi loại là **một khối khung riêng** trong cùng một `sheet.png`, nên manifest có mục `kinds`, mỗi loại có `frame`, `columns`, `offset` (vị trí góc trên trái của khối trong ảnh, px), `body.radius`, `anchor`, `animations`.

| Loại | Bán kính va chạm của game (`body.radius` nên đặt bằng số này) | Khung gợi ý |
|---|---|---|
| `runner` | 11 | 36×36 |
| `brute` | 20 | 64×64 |
| `swarmer` | 9 | 28×28 |
| `spitter` | 12 | 40×40 (bắn xa: thêm `muzzle`) |
| `crusher` (boss) | 34 | 112×112 |
| `gunner` (boss) | 30 | 96×96 (bắn xa: thêm `muzzle`) |

- Số khung gợi ý mỗi loại: `move` 4 đến 6, `attack` 2 đến 3, `hit` 1, `die` 3 đến 4.
- `muzzle` `{x, y}` (px trong khung) là chỗ đạn bay ra khỏi quái bắn xa.
- Hai boss phải nhìn **to và nguy hiểm hơn hẳn** quái thường.
- Quái loại nào thiếu trong họ thì dùng bản do code vẽ của họ đó.

### `base` (căn cứ)

- Khung gợi ý **96×96**, thân vuông `body: { "w": 56, "h": 56 }` (bằng cạnh căn cứ của game).
- Căn cứ được phép **nhô lên phía trên** hình vuông (mái, ăng-ten, tháp pháo) **tối đa 24 px** theo thang game. Phần nhô chỉ để nhìn, không chặn gì. Cách làm: đặt hình vuông 56×56 thấp hơn giữa khung và đặt `anchor.y` tương ứng. Gợi ý: hình vuông chiếm x 20 đến 76, y 24 đến 80 của khung 96×96, tức `anchor: { "x": 0.5, "y": 0.5417 }`, và `"overhang": 24`.
- Số khung gợi ý: `idle` 2, `hit` 2, `low` 4 (có khói), `destroyed` 1 (đống đổ nát).

### `weapon` (súng cầm tay)

- Khung gợi ý **40×24**, súng chĩa sang phải. `anchor` là **điểm nắm tay** (game đặt điểm này cách tâm nhân vật 10 px về phía trước). `muzzle` `{x, y}` là đầu nòng (px trong khung): tia lửa nòng xuất hiện ở đó.
- `bullet`: kiểu đạn, `{ "style": "dot" | "streak", "color": "#rrggbb" }` (`dot` là chấm sáng, `streak` là vệt dài cho đạn xuyên).
- Có đủ 5 súng của game: `pistol`, `rapid`, `heavy`, `shotgun`, `piercing`. Hoạt ảnh `idle` 1 khung, `fire` 2 đến 3 khung.
- **Biểu tượng súng** (thanh súng ở dưới sân hiện một hình nhỏ của từng súng): thêm `"icon": <số khung>` vào manifest, chỉ khung nào dùng làm biểu tượng (không có thì dùng khung đầu của `idle`). Ô trên thanh là 40×40 px, hình được thu nhỏ vừa 32×24; kích thước gợi ý cho một biểu tượng riêng là **32×32**. Gói do code vẽ cho đủ 5 súng đều có `icon`.

### `biome` (phong cảnh)

Không có hoạt ảnh. Manifest có:
- `tiles`: ô nền **64×64**, `count` biến thể xếp thành một hàng bắt đầu từ `offset`. Các ô phải **ghép liền không thấy mép** khi đặt cạnh nhau theo thứ tự bất kỳ (game chọn biến thể theo hạt giống của màn).
- `wall`: một vùng `{x, y, w, h}` trong ảnh làm **kết cấu tường lát được** (ghép lặp lại theo cả hai chiều). Game vẽ bóng đổ lệch 4 px dưới tường.
- `props`: danh sách vật trang trí nhỏ, mỗi cái một hình chữ nhật `{x, y, w, h}` trong ảnh (khoảng 16 đến 40 px). Game rải khoảng 25 đến 40 cái, cách vật cản, căn cứ, người chơi và điểm sinh quái ít nhất 24 px, nằm dưới mọi thứ và không chặn gì.
- `ambient`: hạt trong không khí, một trong `none`, `snow`, `dust`, `fireflies`, `sparks`.

Có 8 phong cảnh, id trùng với `theme` của màn: `zombie-city` (phố đổ nát), `alien-lab` (phòng thí nghiệm), `dark-forest` (rừng), `desert-ruins` (sa mạc), `ice-base` (băng), `neon-arena` (đấu trường neon), `hospital` (bệnh viện), `military-base` (căn cứ quân sự).

### `pickup` và `fx`

Gói cố định: `pickup/health` (hộp máu, khung gợi ý 24×24, `body.radius` 10) và `fx/basic` (hiệu ứng, khung gợi ý 32×32, các hoạt ảnh ở bảng trên).

## 4. Ví dụ `manifest.json`

### Một nhân vật (PNG)

```json
{
  "version": 1,
  "kind": "hero",
  "id": "grunt-test",
  "source": "png",
  "license": "CC0",
  "author": "Tên người vẽ",
  "origin": "https://nơi-lấy-ảnh (có thể để trống nếu tự vẽ)",
  "sheet": "sheet.png",
  "frame": { "w": 48, "h": 48 },
  "columns": 8,
  "body": { "radius": 14 },
  "anchor": { "x": 0.5, "y": 0.5 },
  "animations": {
    "idle":  { "frames": [0],          "fps": 1,  "loop": true },
    "move":  { "frames": [1, 2, 3, 4], "fps": 10, "loop": true },
    "shoot": { "frames": [5, 0],       "fps": 14, "loop": false },
    "hit":   { "frames": [6],          "fps": 10, "loop": false },
    "die":   { "frames": [7],          "fps": 6,  "loop": false }
  }
}
```

### Một họ quái (rút gọn: hai loại; thực tế phải đủ sáu)

```json
{
  "version": 1,
  "kind": "family",
  "id": "bug-hd",
  "source": "png",
  "license": "CC-BY-4.0",
  "author": "Tên người vẽ",
  "origin": "https://nơi-lấy-ảnh",
  "sheet": "sheet.png",
  "kinds": {
    "runner": {
      "frame": { "w": 36, "h": 36 }, "columns": 6, "offset": { "x": 0, "y": 0 },
      "body": { "radius": 11 },
      "animations": {
        "move":   { "frames": [0, 1, 2, 3], "fps": 12, "loop": true },
        "attack": { "frames": [4, 5],       "fps": 12, "loop": false },
        "hit":    { "frames": [6],          "fps": 10, "loop": false },
        "die":    { "frames": [7, 8, 9],    "fps": 10, "loop": false }
      }
    },
    "spitter": {
      "frame": { "w": 40, "h": 40 }, "columns": 6, "offset": { "x": 0, "y": 72 },
      "body": { "radius": 12 }, "muzzle": { "x": 36, "y": 20 },
      "animations": {
        "move":   { "frames": [0, 1, 2, 3], "fps": 8,  "loop": true },
        "attack": { "frames": [4, 5],       "fps": 12, "loop": false },
        "hit":    { "frames": [6],          "fps": 10, "loop": false },
        "die":    { "frames": [7, 8, 9],    "fps": 10, "loop": false }
      }
    }
  }
}
```

(`license` là bắt buộc. Cột `offset` của mỗi loại là vị trí khối khung đó trong `sheet.png`.)

## 5. Quy trình thêm một gói

1. Tạo thư mục `apps/web/public/art/<loại>/<id>/` và đặt vào `sheet.png` cùng `manifest.json`.
2. Thêm một dòng vào `apps/web/public/art/index.json`: `{ "kind": "<loại>", "id": "<id>" }`. Có test kiểm tra index khớp thư mục.
3. Nếu gói là lựa chọn mà engine được phép **tự chọn** cho màn mới (nhân vật, họ quái, căn cứ, súng), thêm id vào `LOOK_OPTIONS` trong `apps/api/src/shooter/look.ts`. Phong cảnh không cần bước này (đi theo `theme`). Có test kiểm tra mọi id trong `LOOK_OPTIONS` đều có gói.
4. Xem thử không cần backend: `http://127.0.0.1:5173/?shooter=art-showcase&hero=<id>&family=<id>&base=<id>&weapon=<id>&biome=<id>` (thêm `&boss=crusher` hoặc `&boss=gunner` để xem boss, `&stress=120` để xem 120 quái). Giá trị lạ bị bỏ qua.
5. Không cần sửa code của game, không cần sửa `packages/contracts`.

Ghi chú: gói PNG thật được trang web đọc rồi gửi vào khung game dưới dạng dữ liệu nhúng (`data:image/png;base64,...`), vì khung game bị cách ly và **không được tải ảnh theo địa chỉ** (chính sách bảo mật CSP không đổi). Mỗi lần mở màn, trang chỉ tải các gói PNG mà màn đó cần, trong tối đa 4 giây, không thử lại.

## 6. Giấy phép chấp nhận được

| Giấy phép | Dùng được? | Ghi chú |
|---|---|---|
| `CC0` (phạm vi công cộng) | Có | Không cần ghi nguồn, nhưng vẫn điền `author` và `origin` nếu biết. |
| `CC-BY-4.0` | Có | **Phải ghi nguồn**: điền đúng `author` và `origin` trong manifest. |
| `own` (tự vẽ) | Có | Ảnh do chính dự án vẽ hoặc tạo; ghi tên người vẽ vào `author`. |
| `procedural` | Có | Ảnh do code tạo ra (như gói thử `grunt-test`). |
| `CC-BY-SA`, `GPL`, "chỉ dùng phi thương mại", "không rõ" | **Không** | Ràng buộc quá nặng hoặc không rõ: không thêm vào repo. |

Mỗi gói PNG phải có `license` (chuỗi bắt buộc). Không đưa ảnh có thương hiệu hay nhân vật của người khác vào.
