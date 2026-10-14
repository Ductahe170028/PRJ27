# Denise Support Tools V1 — Homework Reopen

> **Mục tiêu:** Xây dựng một công cụ nội bộ đơn giản để Tech Support mở lại phần thực hành mà học viên lỡ nộp trên Denise, thay cho việc tìm ID và gọi mutation thủ công bằng Postman.
>
> **Phạm vi V1:** Duy nhất **Homework Reopen**. Không phát triển thêm chức năng khác trong đợt này.
>
> **Nguồn thông tin:** Tổng hợp từ các phản hồi của MindX Tech Bot ngày 12–13/10/2026, được bot mô tả là đã đọc source code LMS, Denise API và web Denise. **Chưa xác thực toàn bộ GraphQL schema/endpoint và chưa chạy thử API Denise trên dữ liệu thật.**

## 1. Bài toán và kết quả mong muốn

**Tình huống:** Học viên làm BTVN (Scratch hoặc nộp file), vô tình bấm **Nộp bài** khi chưa hoàn thành. Sau khi nộp, học viên không thể sửa phần đã nộp; nếu cả bài đã hoàn thành thì giao diện chuyển sang chỉ xem. Tech phải xử lý thủ công bằng Postman để yêu cầu làm lại.

**Trải nghiệm mong muốn của Tech:**

1. Nhập **mã học viên LMS** (ví dụ `26009543`).
2. Chọn đúng học viên và **khóa học Denise** từ danh sách.
3. Xem danh sách **BTVN theo buổi học**, kèm trạng thái các phần thực hành.
4. Bấm **Mở lại** ở đúng phần đã nộp, xác nhận thao tác.
5. Tool kiểm tra kết quả và thông báo thành công/thất bại.

**Không yêu cầu Tech tự tìm LMS ObjectId, Denise student UID, courseId, lessonId hay submissionId.** Các ID chỉ sử dụng nội bộ.

### Ngoài phạm vi V1

- Reset Checkpoint, Quiz, toàn bộ buổi học hoặc tiến độ học viên.
- Tạo lại BTVN bị mất; xử lý Enroll/Withdraw/Transfer và đồng bộ khóa học.
- Mở lại hàng loạt, xử lý nhiều học viên trong một lượt.
- Giao diện quản trị CRM/LMS/Denise tổng quát hoặc trình chạy GraphQL tùy ý.
- Tự động sửa mọi trạng thái bài nộp (`MARKED`, `RE_SUBMITTED`, v.v.).

## 2. Hiểu đúng nghiệp vụ Denise

Một **BTVN hiển thị trên giao diện** tương ứng với một `StudentLesson`, nhưng có thể chứa nhiều bản ghi `StudentSubmission`:

- `QUIZ`: Phần câu hỏi, chấm theo từng câu; không thuộc luồng Homework Reopen.
- `PRACTICE_TASK1`: Một phần thực hành (Scratch hoặc nộp file).
- `PRACTICE_TASK2`: Phần thực hành khác **nếu BTVN có phần này**.

**Không phải buổi nào cũng có đủ ba phần.** Trên web Denise, mỗi phần thực hành có luồng nộp riêng; nộp một phần chỉ chuyển submission đó sang `SUBMITTED`, không tự động nộp các phần khác.

Ví dụ:

| Nội dung trong cùng BTVN | Trạng thái submission |
|---|---|
| Quiz | `MARKED` |
| Practice Task 1 | `SUBMITTED` |
| Practice Task 2 | `IN_PROGRESS` |

Khi còn submission `IN_PROGRESS` (tính cả Quiz), bài **chưa** chuyển `StudentLesson` sang `COMPLETED`. Khi phần cuối được nộp và không còn submission `IN_PROGRESS`, `StudentLesson` mới được đánh dấu `COMPLETED`, web chuyển sang trang chỉ xem.

**Điểm quan trọng cho tool:** Điều kiện được mở lại là **trạng thái của submission thực hành**, không phải bắt buộc cả `StudentLesson` phải `COMPLETED`. Một BTVN có thể đã nộp Task 1 nhưng đang làm Task 2; khi đó vẫn có thể cần mở lại Task 1.

Mutation chính là `StudentSubmission_requestRedoSubmission`, sử dụng luồng **Yêu cầu làm lại** của Denise để chuyển submission đã nộp sang `REDO`, **không** sửa thủ công status thành `IN_PROGRESS` và **không** reset bài.

## 3. Quy tắc chức năng V1

| Submission | Cách hiển thị | Nút Mở lại |
|---|---|---|
| `PRACTICE_TASK1` / `PRACTICE_TASK2` và `SUBMITTED` | Đã nộp | **Cho phép** |
| `IN_PROGRESS` | Chưa nộp | Khóa |
| `REDO` | Đang được yêu cầu làm lại | Khóa |
| `RE_SUBMITTED` | Đã nộp lại | Khóa ở V1 |
| `MARKED` | Đã chấm | Khóa ở V1 |
| `QUIZ` | Trắc nghiệm | Không hiển thị nút |
| BTVN loại `CHECKPOINT` | Checkpoint | Loại khỏi danh sách thao tác |

- Giao diện nhóm theo **một BTVN/một buổi**, không tự tách thành các BTVN khác nhau.
- Nếu có **một** phần thực hành đã nộp, hiển thị một nút **Mở lại** cho phần đó.
- Nếu có **nhiều** phần thực hành, hiển thị từng phần và cho Tech chọn chính xác phần muốn mở; **không tự động mở tất cả**.
- Nếu không có phần thực hành hợp lệ, không có hành động ghi.
- `note` là bắt buộc và có thể được học viên/giáo viên nhìn thấy. Điền sẵn: `Mở lại do học viên lỡ nộp bài khi chưa hoàn thành`; Tech có thể sửa trước khi xác nhận.
- Với **nộp file**: cảnh báo rằng file cũ có thể không tự xuất hiện lại trên form và lần nộp tiếp theo có thể thay thế danh sách file; học viên cần đính kèm lại tất cả file cần giữ.

## 4. Luồng nghiệp vụ và dữ liệu

```text
Mã học viên LMS (studentId)
  └─ LMS.students → đối chiếu studentId trùng chính xác → LMS Student.id
       └─ Denise.StudentCourse_findAll(studentServiceId = LMS Student.id)
            └─ Chọn StudentCourse (courseId, classId, studentUid)
                 └─ Denise.StudentLesson_find(courseId, studentId = studentUid)
                      └─ Lọc đúng classId, bỏ CHECKPOINT, nhóm theo buổi
                           └─ Chọn PRACTICE_TASK1/2 có status SUBMITTED
                                └─ StudentSubmission_findById → kiểm tra lại
                                     └─ Xác nhận + requestRedoSubmission
                                          └─ Query lại, xác minh status REDO
```

### Ánh xạ ID đã được Tech Bot mô tả

| Trường | Ý nghĩa |
|---|---|
| LMS `students.data[].studentId` | Mã học viên Tech nhập, thường là chuỗi số như `26009543` |
| LMS `students.data[].id` | ID bản ghi học viên LMS |
| Denise Student `studentServiceId` | Trỏ tới `LMS Student.id` |
| Denise Student `userId` | ID tài khoản Base, tương ứng `StudentCourse.studentUid` |
| `StudentCourse.courseId` | Khóa học Denise |
| `StudentCourse.classId` | Lớp LMS của lần ghi danh |
| `StudentLesson_find.studentId` | Theo ví dụ bot, truyền `StudentCourse.studentUid` — cần kiểm tra schema/response thực tế |

**Lưu ý:** Tra cứu LMS bằng `filter_textSearch` là tìm kiếm gần đúng; backend phải **so khớp chính xác `studentId`** thay vì lấy bản ghi đầu tiên. Nếu có nhiều bản ghi trùng mã hoặc không có bản ghi trùng, không tự chọn. Denise có thể trả lỗi `Student not found` nếu học viên chưa có tài khoản Denise.

## 5. API GraphQL cần tích hợp

Các document/variables dưới đây **theo MindX Tech Bot**, dùng làm tài liệu khởi tạo. Khi code, đối chiếu lại schema và endpoint của môi trường thực tế; không mặc định mọi field đều đã được thử chạy thành công.

### API 1 — LMS: Tìm học viên theo mã (READ)

```graphql
query FindLmsStudentByCode($p: StudentQuery) {
  students(payload: $p) {
    data { id fullName studentId }
    pagination { total }
  }
}
```

```json
{
  "p": {
    "filter_textSearch": "26009543",
    "itemsPerPage": 5
  }
}
```

Chọn đúng bản ghi có `studentId === "26009543"`, lấy `id`. Nếu LMS trả nhiều kết quả, không chọn theo thứ tự. Nếu có phân trang và chưa xác định được trùng chính xác, cần tiếp tục tìm hoặc báo không xác định được, không đoán.

### API 2 — Denise: Danh sách khóa học (READ)

```graphql
query StudentCourse_findAll($in: FindAllInput!) {
  StudentCourse_findAll(findAllInput: $in) {
    id
    studentUid
    courseId
    classId
    status
    courseVersionId
    isDeleted
    course { id name code operationCourses }
  }
}
```

```json
{
  "in": {
    "studentServiceId": "<LMS Student.id>",
    "isDeleted": false
  }
}
```

Denise tự tra Student bằng `studentServiceId`, rồi lọc khóa theo `studentUid`. Hiển thị tên/mã khóa, lớp và trạng thái nếu có. Có thể lọc trạng thái khóa học sau khi xác minh nghiệp vụ; **không mặc định chỉ lấy `IN_PROGRESS`**, vì học viên có thể cần mở lại bài ở khóa đã kết thúc.

### API 3 — Denise: BTVN và các submission theo khóa (READ)

```graphql
query StudentLesson_find($p: FindStudentLesson!) {
  StudentLesson_find(findStudentLesson: $p) {
    course { id name }
    classes { classId className }
    lessons {
      id
      lessonId
      classId
      sessionNumber
      displayOrder
      availableAt
      status
      type
      lesson { id name type }
      submissions { id category type status score note }
    }
  }
}
```

```json
{
  "p": {
    "courseId": "<StudentCourse.courseId>",
    "studentId": "<StudentCourse.studentUid>"
  }
}
```

**Xử lý kết quả:**

1. Lọc `lessons` theo `classId === StudentCourse.classId` vì một course có thể trả bài của nhiều lớp.
2. Loại bài nếu `type === CHECKPOINT` hoặc `lesson.type === CHECKPOINT`.
3. Một dòng BTVN tương ứng với một lesson. Hiển thị `lesson.name`, `sessionNumber` (hoặc `displayOrder` nếu thiếu).
4. Chỉ xét submission `category` là `PRACTICE_TASK1` hoặc `PRACTICE_TASK2` cho hành động Mở lại. Không dựa vào `category` để suy ra tên hai BTVN khác nhau.

### API 4 — Denise: Đọc lại submission trước thao tác (READ)

```graphql
query StudentSubmission_findById($id: String!) {
  StudentSubmission_findById(id: $id) {
    id
    status
    category
    type
    submittedCount
    classId
    lessonId
  }
}
```

```json
{ "id": "<submissionId>" }
```

Backend phải kiểm tra lại `status === SUBMITTED`, đúng phần thực hành, đúng lesson/class đã chọn và không thay đổi đối tượng kể từ khi tải danh sách. **Không cần tải hoặc log toàn bộ `scratchState`/file đính kèm trong V1**.

### API 5 — Denise: Yêu cầu làm lại (WRITE — duy nhất)

```graphql
mutation StudentSubmission_requestRedoSubmission($payload: RequestRedoSubmissionInput!) {
  StudentSubmission_requestRedoSubmission(payload: $payload) {
    id
    status
    note
  }
}
```

```json
{
  "payload": {
    "id": "<submissionId>",
    "note": "Mở lại do học viên lỡ nộp bài khi chưa hoàn thành"
  }
}
```

**Kết quả mong đợi:** submission chuyển thành `REDO`, Denise hiển thị luồng **Làm lại** để học viên có thể tiếp tục/nộp lại. Không tự khẳng định toàn bộ `StudentLesson.status` trở thành `IN_PROGRESS`: cần kiểm tra hành vi thực tế trên giao diện học viên. Khi nộp lại, submission có thể chuyển `RE_SUBMITTED`.

**Bắt buộc đọc kiểm chứng:** Gọi lại API 4 sau mutation, chỉ báo thành công nếu đúng submission đã chuyển `REDO`. Với GraphQL, phải kiểm tra cả trường `errors` trong body, không chỉ HTTP 200.

## 6. Giao diện V1 (một trang)

```text
┌──────────────────── Homework Reopen ────────────────────┐
│ Mã học viên LMS [ 26009543           ] [ Tìm học viên ] │
│ Học viên: Nguyễn Văn A (26009543)                      │
│ Khóa học: [ Chọn khóa học Denise ▼ ]                    │
│                                                        │
│ Buổi 08 — Tên BTVN                                     │
│   Practice Task 1   Đã nộp         [ Mở lại ]           │
│   Practice Task 2   Chưa nộp       [ Không khả dụng ]   │
│                                                        │
│ Buổi 09 — Tên BTVN                                     │
│   Practice Task 1   Đã nộp         [ Mở lại ]           │
└────────────────────────────────────────────────────────┘
```

*Minh họa bố cục; nội dung thực tế phụ thuộc dữ liệu API.*

Khi nhấn **Mở lại**, hiện hộp xác nhận ngắn gồm **học viên, khóa học, buổi, phần thực hành và lý do** (có thể sửa). Nếu là file upload, kèm cảnh báo file. Trong lúc gọi mutation, khóa nút để tránh thao tác trùng; báo lỗi rõ ràng nếu không xác minh được kết quả.

## 7. Phương án triển khai gọn

Không cần microservice, database riêng, DDD hay kiến trúc phức tạp. Có thể làm **React + TypeScript (UI)** và **Node.js/Express + TypeScript (API/BFF)**:

```text
denise-homework-reopen/
  web/                 # Một trang React
  api/
    routes/             # Các endpoint cố định cho UI
    services/           # Kiểm tra nghiệp vụ, xác nhận trạng thái
    clients/            # Gọi GraphQL LMS và Denise
```

- Backend chỉ expose các endpoint phục vụ đúng luồng Homework Reopen; **không xây GraphQL proxy tùy ý**.
- Không có chức năng ghi nào khác ngoài `StudentSubmission_requestRedoSubmission`.
- Dùng token và quyền truy cập **được công ty cho phép**; credential nằm ở backend trong cấu hình an toàn, không đưa vào frontend, localStorage, repository hoặc log.
- Kiểm tra quyền Tech ở backend trước khi đọc dữ liệu và nhất là trước khi mutation. Ghi audit tối thiểu: người thao tác, thời điểm, mã đối tượng, hành động, kết quả; không ghi token/nội dung bài.
- Không tự retry mutation khi timeout hoặc trạng thái phản hồi không chắc chắn. Đọc lại submission trước khi quyết định thao tác tiếp.

### Thứ tự thực hiện

1. **Code trọn V1 bằng mock:** Hoàn thiện giao diện, trạng thái, xác nhận và các lớp gọi API cố định. Viết test cho điều kiện bật/tắt Mở lại.
2. **Kết nối API đọc thật:** LMS mã HV → Denise courses → Denise lessons/submissions, đối chiếu field, ID và quyền truy cập. Chưa chạy mutation.
3. **Test ghi trên dữ liệu thử nghiệm được phép:** Xác nhận người thao tác/đối tượng, gọi mutation một lần, đọc lại và vào giao diện học viên kiểm tra có thể làm tiếp.
4. **Demo:** Trình diễn từ nhập mã học viên đến mở lại một phần thực hành đã nộp, có thông báo kết quả và audit.

### Các case tối thiểu cần test

- Mã LMS không tồn tại, trả nhiều kết quả tìm kiếm, hoặc chưa có tài khoản Denise.
- Học viên có nhiều khóa học/lớp; chỉ hiển thị bài thuộc lớp đã chọn.
- BTVN có 1 hoặc 2 phần thực hành; Quiz/Checkpoint không xuất hiện hành động mở lại.
- `SUBMITTED` mở được; `IN_PROGRESS`, `REDO`, `MARKED`, `RE_SUBMITTED` bị chặn ở V1.
- Trạng thái đổi giữa lúc tải danh sách và lúc bấm Mở lại → backend từ chối.
- Mutation GraphQL trả `errors` dù HTTP 200; timeout không retry ghi tự động.
- Scratch có thể tiếp tục làm; nộp file hiện cảnh báo đính kèm lại file cũ.

## 8. Những thông tin phải đối chiếu khi tích hợp

1. **URL endpoint** LMS và Denise; headers/auth format, hạn token và cách cấp quyền phù hợp nội bộ.
2. **GraphQL schema thực tế** cho `StudentQuery`, `FindAllInput`, `FindStudentLesson`, `RequestRedoSubmissionInput` và các field trong ví dụ.
3. **Ánh xạ ID** LMS `id` → Denise `studentServiceId` → Denise `studentUid`; đặc biệt tham số `StudentLesson_find.studentId`.
4. **Cơ chế hiển thị sau REDO** trên web học viên (gồm bài Scratch/file), xác nhận không mất nội dung học viên đã làm.
5. Quy trình test mutation với **học viên/lớp thử nghiệm** và quyền sử dụng API được duyệt.

---

**Tiêu chí hoàn thành V1:** Tech nhập mã LMS, tìm đúng khóa học/BTVN, chỉ có thể mở lại **submission thực hành đang `SUBMITTED`** bằng một thao tác xác nhận, hệ thống đọc lại xác minh `REDO`, và học viên thử nghiệm có thể quay lại làm tiếp trên Denise. Các chức năng khác để ngoài phạm vi.
