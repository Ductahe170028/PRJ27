# Nhà cung cấp AI (Gemini, Groq) và giới hạn

Tài liệu ngắn về cách backend nói chuyện với AI. Mã nguồn: `apps/api/src/providers/` (từng nhà cung cấp, danh mục model, giới hạn Groq), `apps/api/src/services/ai-gateway.ts` (ngân sách, thời hạn, hủy) và `apps/api/src/services/request-budget.ts`. AI chỉ được gọi **một lần** cho mỗi game (`POST /api/shooter/generate`): không thử lại ở tầng ứng dụng, không đổi sang nhà cung cấp khác khi lỗi.

## Danh mục model

Chỉ model có gói miễn phí và hỗ trợ đầu ra có cấu trúc (xác minh 2026-11-03). Model đầu tiên của mỗi nhà là mặc định của máy chủ (lựa chọn "Tự động" trong Settings).

| Nhà cung cấp | Model (mặc định đứng đầu) | Cách ép đầu ra |
|---|---|---|
| Gemini | `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.8-flash` | JSON schema; mức "suy nghĩ" thấp nhất mỗi model cho phép |
| Groq | `openai/gpt-oss-20b`, `openai/gpt-oss-120b` | JSON schema (`strict`); `reasoning_effort=low` |

Biến môi trường (xem `apps/api/.env.example`, **không** ghi khóa vào tài liệu hay mã): `GEMINI_API_KEY`, `GROQ_API_KEY` (chỉ cần khóa; nhà không có khóa hiện "unavailable"), `GEMINI_ALLOWED_MODELS`, `GROQ_ALLOWED_MODELS` (thu hẹp danh mục, phân cách bằng dấu phẩy; ID lạ làm nhà đó không dùng được), `AI_REQUESTS_PER_MINUTE` (mặc định 5), `AI_REQUESTS_PER_DAY` (100), `AI_MAX_CONCURRENT` (2), `AI_TIMEOUT_MS` (45000, tối đa 50000).

## Giới hạn của ứng dụng

- Mô tả của người dùng: 1–2.000 ký tự sau khi cắt khoảng trắng; thân yêu cầu HTTP tối đa 16 KB.
- Câu trả lời của mô hình (brief) tối đa 700 token đầu ra và 16 KB; không phải JSON hợp lệ hoặc sai khuôn dạng thì báo lỗi, không thử lại.
- `RequestBudget`: số yêu cầu mỗi phút theo từng địa chỉ máy khách (mọi địa chỉ trong một khối IPv6 /64 tính là một), tổng mỗi ngày và số yêu cầu đồng thời cho cả máy chủ. Vượt thì trả 429 kèm `Retry-After`. Bộ nhớ theo dõi tối đa 1.000 máy khách.
- Thời hạn 45 giây cho mỗi lần gọi AI (`AI_TIMEOUT_MS`); khách ngắt kết nối thì lần gọi bị hủy và chỗ trong ngân sách được trả lại.

## Groq gói miễn phí

Gói miễn phí giới hạn token mỗi phút (TPM) và số yêu cầu mỗi ngày (RPD). Mã trong `groq-rate-limit.ts`:

- Đọc `x-ratelimit-limit/remaining/reset-tokens`, `x-ratelimit-remaining/reset-requests` và `retry-after`. Header token là **TPM**; header yêu cầu là **RPD**, không dùng như RPM. Không có header thì giả định 8.000 TPM.
- Trước mỗi yêu cầu ước lượng token đầu vào (UTF-8 chia 3 cộng phần cố định, có tính cả schema) cộng mức trần đầu ra; thiếu quota thì **chờ tới lúc quota được đặt lại** (cộng 250 ms), và cách nhau ít nhất 2,1 giây giữa hai lần gửi (mức 30 yêu cầu/phút). Chờ có thể hủy, nằm **ngoài** thời hạn 45 giây của một lần gọi; khi ngân sách phút nội bộ đã dùng hết, game phải chờ tới cửa sổ phút kế tiếp (có thể tới khoảng một phút).
- Một lỗi 429 là giới hạn phút hoặc có `retry-after` ngắn (tới 60 giây) thì được thử lại **tối đa một lần** sau khi chờ; mỗi lần gửi đều tính vào ngân sách chung. Hết quota ngày, lỗi khóa, lỗi thanh toán hay thời gian chờ quá 60 giây thì báo lỗi ngay.
- Một yêu cầu tự nó lớn hơn TPM thì báo lỗi ngay: chờ không làm nó nhỏ đi.
- Lỗi `json_validate_failed` (mô hình sinh JSON không khớp schema) được chuẩn hóa thành lỗi `invalid_game_spec`, 422; văn bản của mô hình không bao giờ được chép vào câu trả lời HTTP (chỉ vào chẩn đoán trên đĩa, đã xóa khóa).

Giới hạn: bộ chờ nằm trong một tiến trình backend, không điều phối được ứng dụng khác dùng chung tổ chức Groq; header có thể đã cũ khi ứng dụng khác tiêu quota (lần thử lại có giới hạn xử lý trường hợp đó); ước lượng token không chính xác tuyệt đối.

## Chẩn đoán trên máy phát triển

Mỗi lần tạo game ghi một thư mục `.local-diagnostics/standard-<giờ>-<mã>/` (yêu cầu, đầu ra của mô hình, kết quả kiểm tra, tóm tắt kèm báo cáo dựng màn). Tắt trong production và trong test; `STANDARD_DIAGNOSTICS=0` tắt hẳn, `STANDARD_DIAGNOSTICS=1` bật trong test, `STANDARD_DIAGNOSTICS_DIR` đổi thư mục. Khóa API, header xác thực và chuỗi giống khóa bị xóa khỏi mọi file (`services/redact.ts`); đầu ra quá 64 KB bị cắt.
