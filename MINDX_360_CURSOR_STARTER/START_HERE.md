# Bắt đầu với Cursor

Đọc `MINDX_360_CURSOR_SPEC_V1.md` làm yêu cầu sản phẩm và các tài liệu API trong `reference/` làm nguồn kỹ thuật.

**Chưa bắt đầu tích hợp production ngay.** Trước tiên:
1. Đọc toàn bộ đặc tả, nêu cấu trúc dự án React + TypeScript và Node.js + Express, không DB.
2. Lập bảng truy vết màn hình ↔ operation đã tìm thấy ↔ field/API còn thiếu.
3. Xây frontend theo Tree View + Detail + Related bằng mock có nhiều Lead/nhiều Student trước.
4. Tạo backend adapter GraphQL read-only. Chỉ tích hợp API khi có query document thật và cơ chế xác thực được phép.
5. Không gọi business mutation, không lưu token/PII vào source/log, không chỉnh CRM/LMS gốc.

Hãy làm tuần tự và báo rõ điểm nào chưa được chứng minh thay vì đoán.
