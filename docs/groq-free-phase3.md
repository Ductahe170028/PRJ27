# Phase 3 Advanced — Groq Free, 2026-11-03

## Kết quả đo thực tế

Model giữ nguyên `openai/gpt-oss-20b`, cùng API key đã cấu hình. Không đổi provider/model, bật billing hoặc thêm dịch vụ trả phí. Header tài khoản trả về 8.000 TPM và 1.000 request/ngày. Không có log token của lần Coding 429 trước đây để kết luận chính xác mức tiêu thụ của lần đó; các lượt đối chứng mới không tái hiện 429 thật. Nhánh 429 được kiểm chứng bằng transport/scheduler tests và E2E giả lập header.

Prompt dùng **giống nhau** cho bảng trước/sau:

> Tạo game bắn máy bay đơn giản. Phím trái/phải di chuyển, Space bắn đạn lên trên. Kẻ địch bay xuống liên tục. Bắn trúng địch được 10 điểm, đủ 50 điểm thắng, máy bay chạm địch thì thua.

Đối chứng dùng Planner/Generator/Repair/Orchestrator/GameGenerationService từ commit `2515e1d`, chép vào thư mục diagnostics riêng; không reset working tree. SDK adapter dùng cùng endpoint/model/tham số sampling và đọc thêm header/usage, không bật scheduler mới cho lượt đối chứng. Sau tối ưu dùng pipeline hiện tại. Giá trị dưới đây lấy trực tiếp từ `usage.prompt_tokens` và `usage.completion_tokens`, **không phải số ký tự chia tỷ lệ**.

| Bước | Trước: input / output | Sau: input / output | Cap output trước → sau |
| --- | ---: | ---: | ---: |
| Planning | 361 / 213 | 386 / 100 | 900 → 450 |
| Coding | 1.061 / 799 | 1.058 / 788 | 4.096 → 2.400 |
| Repair 1 | 1.689 / 656 | 1.815 / 617 | 4.096 → 2.400 |
| Repair 2 | 1.736 / 626 | Không cần | 4.096 → 2.400 |
| Tổng | **7.141** | **4.764** | |
| Kết quả | Không qua TypeScript sau 2 lần sửa | Completed sau 1 lần sửa, qua Chromium | |

Giảm **33,3% tổng token trong cặp đo này**, chủ yếu nhờ ít hơn một lượt repair. Input Coding gần như bằng nhau; Repair 1 tăng nhẹ vì source/diagnostic khác. Không suy diễn rằng mọi request đều giảm 33%. Reasoning đã nằm trong output: trước lần lượt 8/311/126/96; sau 6/22/97 token, không cộng lại vào tổng. Đây là một cặp thử, không phải tỷ lệ thành công thống kê.

Chơi artifact sinh thật bằng phím và quan sát pixel trong Chromium sandbox: bắn địch đạt **Điểm 50 / Bạn thắng!**, restart về **Điểm 0**, tiếp cận địch không bắn dẫn đến **Game over**, không có page error hay network attempt. Source AI không được thực thi trong Node, không sửa trạng thái game qua test backdoor. HUD của mẫu còn dòng status tĩnh “Score: 0” do model tạo, bên cạnh điểm thật của host; đây là hạn chế nội dung, không phải bộ đếm điểm của host.

Với prompt phức tạp hơn có boss, đã quan sát lượt chờ 32–43 giây theo header và một lượt qua smoke test với 7.026 token; các lượt khác vẫn hết 2 repair vì code không hợp lệ. Không tuyên bố mọi game có boss sẽ thành công hoặc smoke test chứng minh đầy đủ gameplay. Bản simple ở trên là kiểm chứng mục tiêu máy bay đơn giản.

## Nguyên nhân và thay đổi

- Trước đây cap Coding/Repair là 4.096 token, các bước gọi nối tiếp mà không đọc quota còn lại. Lượt đối chứng simple giảm remaining TPM xuống 663. Chạy tiếp hoặc dùng chung organization với app khác dễ gặp 429.
- Repair trước bọc source vào JSON context, gửi lại title/summary và diagnostic trùng lặp. Bản mới giữ yêu cầu gốc, mechanics/input/objective; source gửi một lần dạng text, bỏ escape dư, tối đa 5 lỗi khác nhau × 240 ký tự. Không cắt source giữa chừng hoặc bỏ chức năng được yêu cầu.
- Provider trả `setup`/`update`/`helpers`; backend chỉ thêm chữ ký TypeScript cố định rồi chuyển về contract `{source}`. Model vẫn viết toàn bộ gameplay. Không có template shooter trong production. Bounds kế hoạch khớp schema hiện hành.
- Cap Planning 450, Coding/Repair 2.400, `reasoning_effort=low`. Lỗi output/JSON vẫn đi qua tối đa 2 vòng repair, không chạy artifact thiếu/hỏng.
- Groq đọc `x-ratelimit-limit/remaining/reset-tokens`, `remaining/reset-requests`, `retry-after`. Token headers là TPM; request headers là **RPD**, không dùng chúng như RPM. Tham chiếu [Groq rate limits](https://console.groq.com/docs/rate-limits).
- Trước request: ước lượng input bằng UTF-8/3 + overhead (có tính schema) cộng cap output. Đây là **ước lượng admission**, khác usage thực đo. Header override fallback 8.000 TPM; tối thiểu 2,1 giây giữa lần dispatch theo mức 30 RPM Free hiện dùng. Chờ tới reset + 250ms nếu thiếu quota. Chờ có AbortSignal, nằm ngoài timeout HTTP 45 giây nhưng trong deadline toàn pipeline 4 phút.
- Một 429 được xác định là throttle phút hoặc có retry-after ngắn được retry **tối đa 1 lần/request**, có chờ. Quota ngày, billing, auth, quota không rõ hoặc retry quá 60 giây dừng rõ ràng. Mỗi HTTP attempt tính vào budget chung. Khi chia nhỏ chạm budget phút nội bộ, chờ cửa sổ kế tiếp; không tăng giới hạn ngày/phút.
- Request riêng lẻ lớn hơn TPM: chia theo biên logic setup rồi update/helpers. Phần sau nhận đúng setup và yêu cầu đầy đủ. Cap từng phần tối đa 900/2.200, giảm thêm theo dung lượng. Không lặp request quá lớn với hy vọng chờ sẽ làm nó nhỏ đi. Phần nhỏ vẫn không đủ chỗ thì báo lỗi. Source ghép phải qua cùng toàn bộ validation.
- Usage input/output/reasoning và thời gian chờ xuất hiện trong stream status/log hiện có. Không thay API public, GameSpec, GameAPI, CSP, iframe flags, compiler policy hoặc runtime budget; không thêm dependency.

Giới hạn: bộ chờ nằm trong một backend process, không điều phối được ứng dụng khác dùng chung organization. Headers có thể đã cũ khi app khác tiêu quota; retry có giới hạn xử lý trường hợp đó. Tokenizer ước lượng không chính xác tuyệt đối; phản hồi capacity của Groq kích hoạt chia nhỏ. Model vẫn có thể sinh game sai ngữ nghĩa; giữ kiểm tra hiện có và báo lỗi thay vì nới sandbox. Standard và Gemini không tự retry hoặc đổi lựa chọn.

## Chạy và đo lại trên Windows

Giữ `.env` hiện tại, chạy ở root:

```powershell
npm run dev
```

Mở `http://127.0.0.1:5173`, chọn Advanced AI Mode → Groq → dùng prompt simple phía trên. Khi có thông báo chờ quota, để lượt hiện tại hoàn thành. Không cần điền thêm model/key ở frontend.

Đo live riêng, **có tiêu quota Groq**, không thuộc unit/E2E tự động:

```powershell
npm run build
node --import tsx apps/api/test/groq-live.smoke.ts --live --simple
```

Bỏ `--simple` để thử prompt có boss. Script in usage đã chọn lọc ra console và không ghi đè file legacy `groq-*.json` / `groq-*-game.ts`. Mỗi lượt Advanced tạo một thư mục mới `.local-diagnostics/advanced-YYYYMMDD-HHMMSS-xxxx/` (gitignore, lint ignore), không lưu API key hay header Authorization. `latest-advanced.txt` chỉ chứa runId của lượt vừa mở. Dữ liệu đối chứng cũ vẫn nằm ở `.local-diagnostics/groq-baseline-simple.json`.

## Regression

Các test mới bao phủ header duration/retry-after, TPM/RPD, request quá lớn, hàng chờ, abort/timer cleanup, pacing ngoài HTTP timeout, retry tối đa một lần, budget nội bộ, SDK usage, ghép source/chia nhỏ, bảo toàn yêu cầu, giới hạn 2 repair và sandbox. E2E giả lập 429 rồi hoàn thành cùng một job với log usage; Standard/Gemini/Settings và các kiểm tra sandbox cũ vẫn được chạy.

| Kiểm tra | Kết quả |
| --- | --- |
| Lint | Qua, không warning ESLint |
| Typecheck strict | Qua toàn bộ workspaces/test/tooling |
| Build | Qua frontend, cả hai Phaser runtime và backend |
| Unit/API/frontend | 204/204 qua; bộ trước tối ưu có 186 test |
| E2E Chromium | 24/24 qua; bộ trước tối ưu có 23 test |
| Live Groq simple | Completed, 1 repair, đã chơi thắng/restart/thua |

Lượt E2E đầu phát hiện hai lỗi trong test: CDP không đọc lại body stream đã bị reader đóng, và listener chặn heartbeat được đăng ký quá muộn. Đã chuyển sang xác nhận status/log hiển thị và đăng ký listener test trước ứng dụng; chạy lại toàn bộ đạt 24/24. Không sửa hoặc tắt watchdog production để làm test qua. Build còn warning annotation `@__PURE__` từ Zod như trước, không có lỗi build. Không triển khai Phase 4.
