# Plan: Áp dụng DDD + Hexagonal Architecture cho HRM + Workplace (v-Work-API)

## 1. Bối cảnh

Codebase hiện tại (`controllers/ services/ models/ routes/ middlewares/ helpers/`) đã tự phát triển
một pattern tốt ở module `Request`: tách business logic ra `helpers/*.js` (pure function, test không
cần Express req/res), chuyển từ authorization hard-code role sang RBAC permission-based
(`Permission/Role/RolePermission/UserRole` + `can()`/`requirePermission()` trong `helpers/rbac.js`).
Quyết định lần này: **hình thức hoá pattern đó thành DDD + Hexagonal Architecture thật sự** — không
phải vì pattern cũ sai, mà để có ranh giới rõ ràng hơn khi domain phức tạp dần lên, và để tách hẳn
domain logic khỏi Mongoose/Express (đổi ODM/framework sau này không phải sửa domain).

Phạm vi đợt này: **HRM + Workplace**. CRM (`Customer`, `Investment`, `Agent`...) để sau.

## 2. Quyết định kiến trúc đã chốt

- **Không dùng CQRS bus** (không `CommandBus`/`QueryBus` với đăng ký/dispatch runtime theo tên class).
  Lý do: 1 process Express duy nhất, team nhỏ, không có nhu cầu dynamic dispatch.
- **Có dùng `Command` như base class nhẹ** (id + metadata: `correlationId/timestamp/userId`) — chuẩn
  hoá input cho mọi entry point (controller nội bộ, webhook hệ thống ngoài như
  `investments/upsert`/`omicall/call-hooks`, cron job), nhưng **gọi thẳng application service**, không
  qua bus. Bài học rút ra từ `attendance` (excel import vs app check-in, merge qua
  `resolveAttendanceDay`) — pattern "nhiều entry point, 1 application service xử lý" đã chứng minh hiệu
  quả mà không cần bus.
- **Vấn đề thật từ việc có nhiều hệ thống gọi vào/ra là idempotency ở tầng adapter** (webhook có thể bị
  gọi lại) — xử lý riêng ở từng adapter khi module đó có tích hợp ngoài, không phải việc của
  Command/CQRS.
- **Đọc (read/list) vẫn bypass domain** — query Mongoose thẳng để trả dữ liệu hiển thị, không ép Entity
  hoá cho việc liệt kê (giữ đúng cái đang làm tốt ở `RequestController.getAll` hiện tại).
- **Cấu trúc thư mục theo aggregate, phẳng** (`src/modules/<aggregate>/`), không thêm lớp `hrm/`/
  `workplace/` — vì `module_access` là khái niệm authorization (RBAC), không phải ranh giới thư mục.

## 3. Domain Service vs Application Service — vì sao `helpers/` không đổi thành `application/`

Đây là 2 khái niệm khác nhau trong DDD, không phải né việc dọn dẹp:

- **Domain Service**: logic nghiệp vụ thuần, **không thuộc về 1 aggregate cụ thể**, thao tác trên
  nhiều entity/aggregate cùng lúc. Ví dụ: `getApprovalChain()` đi qua `Department` +
  `UserDepartmentPosition` + `Account` để tìm người duyệt — không "thuộc về" riêng `Request` hay
  `User`. `rbac.js`/`can()` cũng vậy — dùng chung cho mọi aggregate cần check quyền.
- **Application Service** (`application/<use-case>.service.js`): đại diện cho **đúng 1 use-case** (1
  Command). Nhận input → load aggregate qua repository → gọi domain logic → lưu lại → publish event.
  Nó **gọi** domain service khi cần, không phải chính nó là domain service.

Ví dụ: `review-request.service.js` (Application Service — use-case "duyệt đơn") **gọi**
`getApprovalChain()` (Domain Service). `create-request.service.js` cũng gọi lại đúng hàm đó để tìm
người cần thông báo — vì nó dùng chung cho nhiều use-case, không thể gộp vào 1 service cụ thể.

`helpers/*.js` hiện tại đã đúng vai trò Domain Service — **giữ nguyên vị trí, không di chuyển** (di
chuyển file đã test kỹ, dùng ở nhiều nơi, là thay đổi cơ học rủi ro cao không có lợi ích kiến trúc
thật). Việc cần làm chỉ là ghi rõ vai trò này trong tài liệu (mục 4), không đổi code.

**Đính chính (task 1.9, sau khi verify thật bằng `grep` toàn repo — xem quy tắc mới ở mục 5):** lập
luận "dùng ở nhiều nơi" ở trên **chỉ đúng với `rbac.js`/`can()`** (xác nhận dùng ở 12 route file,
nhiều module không liên quan — cross-cutting thật). Với `getApprovalChain`/`getManagedUserIds`
(`helpers/approvalChain.js`) và `resolveReviewerProfileByAccountId` (`helpers/requestUtils.js`) —
grep toàn bộ 211 file cho thấy **CHỈ có `Request`** (`RequestController.js` cũ + các file
`modules/request/` mới) từng gọi 3 hàm này, không consumer nào khác. Lập luận ban đầu dựa vào **cấu
trúc bên trong** hàm (đi qua nhiều model: `Department`/`UserDepartmentPosition`/`Account`) — không
phải tiêu chí đúng; Domain Service "dùng chung" phải xét theo **ai thực sự tiêu thụ nó**. Kết luận
đúng hơn: đây là **Domain Service riêng của bounded context `Request`**, đặt sai chỗ (`helpers/`
chung, thay vì `modules/request/domain/`).

**Quyết định:** giữ nguyên vị trí trong lúc làm task 1.9 (`getById`, vẫn import từ `helpers/` như cũ,
tránh trộn 2 loại thay đổi trong 1 task), **tách thành 1 task riêng ngay sau 1.9** để di chuyển 3 hàm
này vào `modules/request/domain/`, sửa lại import ở mọi nơi đang dùng (kể cả `RequestController.js`
cũ, vẫn còn sống tới task 1.15), review độc lập.

## 4. Cấu trúc thư mục

```
src/
  core/                                 # Phase 0 — building block dùng chung, viết 1 lần
    ddd/
      entity.base.js
      aggregate-root.base.js
      value-object.base.js
      domain-event.base.js
      command.base.js
                                         # mapper.interface.js/repository.port.js: đã xoá ở task 0.9
                                         # (JSDoc-only, 0 giá trị runtime trong dự án JS thuần)
    exceptions/
      exception.base.js
      exceptions.js
    context/
      request-context.js                # AsyncLocalStorage — correlationId
    db/
      mongoose-repository.base.js       # bọc Mongoose Model + Mapper → trả Entity
      run-in-transaction.js             # task 1.10 — bọc transaction, map TransientTransactionError
                                         # -> ConflictException (409); dùng chung 1.10/1.11/1.12/1.13
    http/                                # thêm ở task 1.6 — dùng chung cho MỌI module mới (không riêng request)
      handle-exception.js               # map ExceptionBase -> { message } / lỗi lạ -> 500 { message, error }
      error-handler.middleware.js       # Express error middleware (err, req, res, next), gọi handle-exception
      async-handler.js                  # bọc controller action async — Express 4 không tự forward promise
                                         # rejection tới error middleware, phải tự next(err)
      parse-pagination.js               # thêm ở task 1.7 — clamp page/limit, dùng chung 1.7/1.8/1.9

  modules/                              # mỗi aggregate 1 folder, PHẲNG (không có hrm/ hay workplace/)
    request/                            # Phase 1 (pilot)
      domain/
        request.entity.js               # AggregateRoot — invariant thật của Request
        request.errors.js
        approval-chain.js               # task 1.9b — move từ helpers/approvalChain.js (chỉ Request dùng)
        resolve-reviewer-profile.js     # task 1.9b — tách từ helpers/requestUtils.js (chỉ Request dùng)
        request-type-handlers.js        # task 1.10 — registry request_type -> handler, dùng chung 1.10/1.11/1.12
        request-type-labels.js          # task 1.12 — tách từ create-request.service.js, dùng chung create/review
        events/
          request-created.domain-event.js
          request-approved.domain-event.js
          request-rejected.domain-event.js # task 1.12 — thêm field overriddenApprovals (đề xuất A)
      application/                      # Application Service = 1 use-case, gọi thẳng infra/helper (không qua port)
        create-request.service.js       # gọi lại domain/approval-chain.js, helpers/rbac.js bên trong
        review-request.service.js       # task 1.12 — nhánh 1 người duyệt; entity.approve() lo cả đa duyệt
                                         # (tuần tự) nhưng CHƯA có Redis lock/rule trưởng bộ phận (1.13)
        get-eligible-reviewers.service.js # đọc, không qua Entity — CQRS-lite (task 1.6)
        get-my-requests.service.js      # đọc thẳng Mongoose, KHÔNG .lean() (giữ toJSON format — task 1.7)
        get-all-requests.service.js     # getAll — task 1.8, gọi resolve-request-view-scope.js
        get-request-by-id.service.js    # getById — task 1.9, KHÔNG dùng chung resolve-request-view-scope.js
                                         # (rule khác shape — xem task 1.9), memoize getApprovalChain 1 lần
        resolve-request-view-scope.js   # tách theo Solution B (task 1.8) — {type: all|managed}
        request-query-filters.js        # applyRequestTypeFilter/applyDateRangeFilter/buildUserNameSearchFilter
                                         # dùng chung 1.7/1.8, escape regex cho search (task 1.8)
        cancel-request.service.js       # task 1.10 — action GHI đầu tiên, dùng run-in-transaction.js
        create-request.service.js       # task 1.11 — dispatch 7 handler, toHandlerException() cục bộ
      infrastructure/
        request.repository.js           # nơi DUY NHẤT được require RequestModel trực tiếp
        request.mapper.js
      interface/
        request.http.controller.js      # controller — handler mỏng, KHÔNG tự try/catch (asyncHandler lo)
        request.routes.js               # express.Router() sống Ở ĐÂY, không phải src/routes/request.js
                                         # (route definition thuộc về module — xem "Quan sát cấu trúc"
                                         # bên dưới); tạm thời còn require RequestController cũ cho action
                                         # chưa migrate, đến task 1.15 sẽ chỉ còn code mới

    internal-file/                      # Phase 2 — cấu trúc y hệt, chưa làm
    user/                               # Phase 3
    department/                         # Phase 4
    weekly-report/                      # Phase 5
    chat/                               # Phase 6
    post/                               # Phase 7
    labor-contract/                     # Phase 7
    attendance/                         # Phase 8

  helpers/                              # GIỮ NGUYÊN VỊ TRÍ NẾU dùng chung ≥2 module (xem quy tắc mục 5)
    rbac.js                             # dùng thật ở 12 route file — Domain Service dùng chung, giữ nguyên
    requestUtils.js                     # resolveReviewerProfileByAccountId đã tách ra (1.9b); phần còn lại
                                         # (calcTotalDays, notify, acquireRequestReviewLock...) chờ move
                                         # dần khi 1.11/1.13 đụng tới — xem lý do ở task 1.9b
    attendanceHelper.js
    ...                                 # approvalChain.js đã xoá (move hết sang modules/request/domain/,
                                         # task 1.9b) — không còn đúng "1 file = giữ nguyên vị trí" mặc định
                                         # nữa, phải grep verify từng lần đụng tới (xem mục 5)

  services/                             # 2 file cũ — reclassify, không xoá
    chatService.js                      # giữ nếu đúng nghĩa "orchestration + I/O ngoài" (Socket.io)
    notificationService.js              # giữ nếu gọi Firebase FCM — đúng nghĩa integration service
                                         # không tạo thêm file mới ở đây trừ khi đúng nghĩa I/O ngoài

  models/                               # Mongoose schema — KHÔNG di chuyển, 53 file giữ nguyên chỗ
  controllers/                          # LEGACY — co dần khi từng module migrate xong
    RequestController.js                # → xoá ở task 1.12 sau khi request/ migrate xong + approve
    UserController.js                   # → còn tới Phase 3
    ...
  routes/                               # giữ nguyên chỗ, nội dung từng file trỏ dần sang controller mới
    request.js                          # → require modules/request/interface/request.http.controller.js
    user.js                             # → vẫn require controllers/UserController.js tới Phase 3

  middlewares/ jobs/ sockets/ config/ utils/ constants/    # không đổi, cross-cutting, ngoài phạm vi
```

**Quy tắc thực thi (quan trọng hơn cả vị trí thư mục — đây là ranh giới Hexagonal thật):**
- Chỉ `modules/<x>/infrastructure/<x>.repository.js` được `require` trực tiếp Mongoose Model của
  aggregate đó — mọi nơi khác (kể cả `application/`, kể cả controller cũ chưa migrate) phải đi qua
  repository.
- `application/` được gọi `helpers/` (Domain Service) thoải mái, nhưng `helpers/` **không được** gọi
  ngược lại `application/`/`infrastructure/` của bất kỳ module nào — tránh phụ thuộc vòng.
- `interface/` (controller) chỉ được gọi `application/`, không được gọi thẳng `domain/` hay
  `infrastructure/`.

**Trong lúc migrate (nhiều tuần/tháng):** `controllers/` và `modules/` tồn tại song song — module nào
đã migrate thì route trỏ sang `modules/`, module chưa tới lượt vẫn trỏ `controllers/` như cũ. Không có
thời điểm nào toàn bộ app phải "chuyển hẳn" cùng lúc.

## 5. Cách làm việc

Claude code trực tiếp vào repo, chia nhỏ theo task. Sau mỗi task, dừng lại để review qua `git diff`
trước khi sang task tiếp theo — không dồn nhiều task rồi mới review. Claude không tự `git commit`/
`git push`. Nguyên tắc: 1 task = 1 commit tiềm năng = 1 loại thay đổi; không xoá code cũ cho tới khi
code mới đã chạy + test pass; test cũ phải luôn xanh (chỉ thêm test mới, không sửa test cũ để "cho
pass").

**Nhắc lại (2026-07-30) — dừng sau MỖI FILE, không phải mỗi task.** Trong lúc làm 1 task có nhiều
file (vd application service + controller + route + test), sau khi viết/sửa xong **1 file duy nhất**
phải dừng lại để người dùng xem/hỏi trước khi viết file tiếp theo — không viết liền một mạch nhiều
file trong task rồi mới dừng. Áp dụng lại từ task 1.10 trở đi (đã lỏng lẻo dần từ task 1.6 khi task
phức tạp lên, cần siết lại).

**Ưu tiên dùng thư viện có sẵn, không tự build lại thứ đã được giải quyết tốt** (vd deep-equal, xử lý
ngày giờ...) — nhưng phải là thư viện **còn được maintain**, không chọn gói đã ngừng cập nhật chỉ vì nó
nhỏ/gọn. Cụ thể: dùng gói `lodash` chính (`require("lodash/isEqual")` — deep-import, không load cả
thư viện), **không** dùng các gói rời kiểu `lodash.isequal`/`lodash.clonedeep` (loạt gói modular tách
riêng của lodash đã ngừng phát hành từ 2018, dừng ở version 4.5.0). Trước khi thêm dependency mới,
kiểm tra thời điểm phát hành gần nhất + có đang được maintain không, không chỉ xem nó có hoạt động hay
không.

**Mọi thứ thêm mới/chỉnh sửa đều phải test trước khi báo xong task** — không chỉ `node --check` +
`eslint` (chỉ bắt lỗi cú pháp/style), mà phải chạy thử logic thật (smoke test bằng `node -e`, hoặc unit
test nếu đã tới lúc viết) để xác nhận hành vi đúng như mô tả, đặc biệt với method có logic thật (không
chỉ getter/setter đơn giản). Đã áp dụng ở task 0.2 (`publishEvents` — smoke test `Promise.allSettled`)
và 0.3 (`equals()` — smoke test xác nhận bug key-order đã sửa đúng) — giữ thói quen này cho mọi task
sau, không chỉ khi bị phát hiện bug.

**Mọi code viết ra phải đạt chuẩn senior** — không chỉ chạy đúng, mà còn phải: an toàn theo mặc định
(safe-by-default) hơn là dựa vào quy ước "nhớ dùng đúng cách" (ví dụ: `RequestContextService.run()`
throw ngay nếu bị gọi lồng, thay vì chỉ đặt tên method rõ ràng rồi hy vọng không ai gọi nhầm — xem task
0.7 review vòng 2); tên method tường minh, phản ánh đúng ý nghĩa (`runChild()` khác `run()` phải khác
nhau rõ ràng, không chỉ khác ở cách dùng ngầm định); và luôn cân nhắc đánh đổi/rủi ro còn sót lại thay
vì coi 1 fix là xong hẳn — nêu rõ trong tiến độ nếu có đánh đổi đã chấp nhận (chưa giải quyết hết mọi
trường hợp) để tránh ai đó sau này tưởng đã an toàn tuyệt đối.

**Chủ động đề xuất khi thấy tổ chức code không hợp lý — không chỉ port y nguyên rồi im lặng.** Khác với
nguyên tắc "giữ nguyên hành vi nghiệp vụ cũ, không tự sửa" (áp dụng cho **business logic** — xem "phát
hiện nghiệp vụ" ở task 1.1), nguyên tắc này áp dụng cho **cách tổ chức code** (ranh giới module, chỗ đặt
route/middleware...). Phát hiện gì không hợp lý phải nêu ra + đề xuất sửa theo chuẩn senior ngay, không
im lặng port theo, và cũng không tự ý sửa mà không xác nhận trước nếu ảnh hưởng ra ngoài phạm vi 1 task.

**Quy tắc cụ thể cho `helpers/*.js` (hoặc bất kỳ hàm/module dùng chung nào) khi đụng tới trong lúc
migrate — áp dụng MỌI lần, không chỉ 1 lần rồi thôi:** trước khi chấp nhận 1 hàm là "Domain Service
dùng chung" (nên ở `helpers/`) hay "domain service riêng của 1 module" (nên chuyển vào
`modules/<module>/domain/`), phải `grep` thật xem **ai đang thực sự gọi nó** trên toàn repo — không
suy luận qua cấu trúc bên trong hàm (đi qua bao nhiêu model không nói lên nó dùng chung hay không).
Nếu chỉ 1 module gọi → domain service riêng của module đó, đặt sai chỗ nếu còn ở `helpers/` chung;
nếu ≥2 module không liên quan cùng gọi → đúng là dùng chung, giữ ở `helpers/`. Xem case cụ thể ở task
1.9 ngay dưới đây — áp dụng đúng quy tắc này lật lại 1 kết luận đã chốt sai ở mục 3.

**Case cụ thể đã áp dụng nguyên tắc trên (task 1.6) — router bị chẻ đôi giữa `src/routes/` và
`src/modules/*/interface/`:** Phát hiện `src/routes/request.js` (ngoài module, thuộc composition root)
phải require controller từ trong `src/modules/request/interface/` — tầng "interface adapter" bị tách
làm 2 nơi. Đã thảo luận 2 phương án (đề xuất ban đầu vs. phương án user đưa thêm dùng tên
`presentation/` + global error-handler middleware), chốt phương án kết hợp:
- Route definition (`express.Router()` + path/method) chuyển hẳn vào module — dùng tên `interface/`
  (đã là tên chốt từ mục 4, KHÔNG đổi sang `presentation/` dù 2 tên tương đương — tránh rename không cần
  thiết khi 3 module con đã tạo theo tên cũ).
- Thêm **global error-handler middleware** (`core/http/error-handler.middleware.js`) thay vì mỗi
  controller action tự try/catch gọi `sendExceptionResponse()` — safe-by-default hơn, khớp nguyên tắc đã
  chốt ở task 0.7. Phải thêm kèm `core/http/async-handler.js` vì **Express đang ở bản 4.19.2** (đã check
  `package.json`), không tự forward promise rejection từ async handler tới error middleware như Express
  5 — cần tự bọc `next(err)`. **Quyết định không nâng cấp Express 5** để lấy tính năng này: rủi ro/blast
  radius quá lớn so với lợi ích (breaking change ở `path-to-regexp` ảnh hưởng tới toàn bộ ~30 router file
  hiện có, phải audit tương thích mọi middleware Express-ecosystem đang dùng — hoàn toàn ngoài phạm vi
  migrate DDD/Hexagonal); `asyncHandler` 5 dòng giải quyết đúng vấn đề với rủi ro gần bằng 0.
- Global error handler **chỉ áp dụng cho route dùng `asyncHandler`** (tức route đã migrate) — route cũ
  (`RequestController.*`, và toàn bộ ~29 module khác) vẫn tự try/catch + `res.status(...)` như cũ, không
  bao giờ gọi `next(err)` nên không bị ảnh hưởng gì, 2 kiểu cùng tồn tại song song an toàn.
- **Bỏ qua** ý tưởng `request.validation.js` (validate format bằng Express middleware) cho module này —
  `create` đã có sẵn `handler.validate()/validateAsync()` riêng theo từng loại đơn (7 handler), plan đã
  chốt tái sử dụng nguyên (task 1.11); thêm tầng middleware validate nữa sẽ trùng lặp, không cần thiết.
  Đáng cân nhắc lại cho **module tương lai không có sẵn pattern `validate()` tách riêng**.

**Tiện thể sửa luôn 1 chỗ tài liệu bị lệch thực tế:** mục 4 (cấu trúc thư mục) vẫn liệt kê
`mapper.interface.js`/`repository.port.js` dù 2 file này đã xoá từ task 0.9 — quên cập nhật lúc đó, sửa
lại luôn trong lần này.

**Path import — dùng relative path, chưa dùng alias.** Đã cân nhắc lúc viết Phase 1: toàn bộ 211 file
hiện có trong repo đều dùng relative path (`require("../models/...")`), không có `@`-alias hay cơ chế
path mapping nào. `@` không dùng được với `imports` field gốc của Node (spec bắt buộc key phải bắt đầu
bằng `#`, không chấp nhận `@`) — muốn có đúng `@` cần thêm package ngoài (`module-alias`) + cấu hình
riêng cho Jest (`moduleNameMapper`) để 2 nơi (runtime + test) không lệch nhau. Tạm hoãn, chưa quyết —
tiếp tục dùng relative path khớp convention cũ, quay lại bàn nếu path quá sâu gây khó chịu thật sự.

**Cập nhật (2026-07-29) — đã verify thật, chưa áp dụng:** sau task 1.7, path bắt đầu sâu/rối (`../../../`
lặp lại nhiều). Đã thử nghiệm `imports` field gốc của Node (`#core/*`, không cần package ngoài) bằng
scratch project riêng: `node` require qua `#core/*` chạy đúng ngay. Quan trọng hơn — **test luôn bằng
chính Jest 30.4.1 của dự án (không phải bản tải rời)**: Jest 30 tự resolve `#core/*` **không cần
`moduleNameMapper`** — lo ngại "2 nơi phải khớp nhau" ghi ở trên **không còn đúng với Jest 30** (có thể
đúng với Jest cũ hơn, chưa cần xác minh lại vì dự án đang ở 30.4.1). Đã thử thêm field `imports` thật
vào `package.json` để xác nhận trên chính dự án nhưng **bị dừng lại theo yêu cầu** ("thôi cứ tạm bỏ qua
cái này đã") — chưa áp dụng, giữ nguyên relative path cho tới khi quyết định tiếp. Nếu sau này muốn làm:
zero dependency mới, chỉ cần thêm field `imports` vào `package.json` + đổi dần require ở file mới/khi
sửa tới (không cần rename toàn bộ 211 file cùng lúc).

## 6. Phase 0 — Core building blocks (rủi ro = 0, không đụng code cũ)

- [x] 0.1 — `src/core/ddd/entity.base.js` (review vòng 2: `getProps()` freeze lại, `updateProps` →
      `_setProps` nội bộ, constructor param 2 đổi từ positional `isNew` → named `{ validate = true }`)
- [x] 0.2 — `src/core/ddd/aggregate-root.base.js`. Review phát hiện bug thật ở `publishEvents()`:
      `Promise.all` fail-fast khiến `clearEvents()` không chạy khi 1 event lỗi → retry cùng instance sẽ
      emit lại cả event đã thành công. Sửa bằng `Promise.allSettled` (không event nào bị bỏ sót dù có
      event khác fail) + `clearEvents()` ngay từ đầu (không dựa vào buffer để "nhớ" event nào đã emit —
      vì thực tế không ai retry cùng instance, mỗi request tạo entity mới) + throw `AggregateError` gom
      lỗi cho tầng gọi tự quyết định best-effort hay không. **Quyết định rõ:** đây là delivery
      best-effort/in-memory, không phải at-least-once — không có outbox. `application/<x>.service.js`
      (không phải aggregate) chịu trách nhiệm catch lỗi từ `publishEvents()` và không để nó làm fail
      cả use-case chính (đã thành công lưu DB) — ví dụ cụ thể xem trong thảo luận, sẽ áp dụng khi viết
      task 1.6/1.7. EventEmitter cụ thể (built-in hay `eventemitter2`) vẫn để ngỏ tới lúc wiring
      composition root Phase 1.
- [x] 0.3 — `src/core/ddd/value-object.base.js`. Tự chứa (không phụ thuộc `exceptions.js` vì task 0.6
      chưa làm tới) — dùng `Error` thường cho guard rỗng. Hỗ trợ VO 1 giá trị (`{value}`) và VO nhiều
      field. Review phát hiện bug thật ở `equals()`: dùng `JSON.stringify` so sánh — 2 object cùng data
      nhưng khai báo key khác thứ tự sẽ ra 2 chuỗi khác nhau → `equals()` trả `false` sai. Sửa bằng
      `lodash` (`require("lodash/isEqual")`, thêm dependency mới, xem nguyên tắc ở mục 5) thay vì tự
      viết deep-equal. Đã smoke test: cùng data khác thứ tự key → `equals()` đúng `true`; data khác
      nhau → đúng `false`.
- [x] 0.4 — `src/core/ddd/domain-event.base.js`. Bắt buộc `props.aggregateId` (event phải biết thuộc
      aggregate nào). **`metadata.correlationId` CHƯA auto-fill từ request-context** — task 0.7 chưa
      làm tới, file này tự chứa, chỉ nhận `correlationId` nếu caller truyền tay. Cần quay lại file này
      khi làm task 0.7 để auto-fill mặc định từ context. Đã smoke test: id unique mỗi event, field
      subclass truyền đúng, guard `aggregateId` thiếu thì throw.
- [x] 0.5 — `src/core/ddd/command.base.js`. Tự chứa như 0.4 — `metadata.correlationId` CHƯA auto-fill
      từ request-context (task 0.7 chưa làm tới, cần quay lại nối dây khi 0.7 xong, ghi chú y hệt
      `domain-event.base.js`). Không có CommandBus — entry point tự gọi thẳng application service (đã
      chốt ở mục 2). Đã smoke test: id tự sinh unique, `id` truyền tay được giữ nguyên, field subclass
      truyền đúng, guard props rỗng/null/undefined đều throw.
- [x] 0.6 — `src/core/exceptions/exception.base.js` + `exceptions.js`. Không tách riêng
      `exception.codes.js` (khác bản `js/` mẫu) — code inline luôn trong từng class cho gọn, đúng ý
      "chỉ 2 file" của task này. Mỗi exception có sẵn `statusCode` (400/404/409/500) để sau này error
      middleware map thẳng, không cần bảng tra riêng — giữ đúng response format `{message, error}` đã
      quy ước `CLAUDE.md`. Review lint phát hiện 2 lỗi thật: `max-classes-per-file` (tắt có chủ đích,
      giải thích rõ trong file — gom nhóm exception nhỏ liên quan, không phải file phình to lộn xộn) và
      `default-param-last` (constructor `NotFoundException`/`InternalServerErrorException` có tham số
      default đứng trước tham số không default — sửa bằng `options = {}`). Đã smoke test đầy đủ: code/
      statusCode đúng từng loại, default message, cause/metadata giữ nguyên, `toJSON()` đúng format,
      stack trace đúng tên class, tất cả đều `instanceof Error`.
      **Còn nợ:** `entity.base.js`/`value-object.base.js`/`domain-event.base.js`/`command.base.js`
      (task 0.1-0.5) hiện đang throw `Error` thường cho guard rỗng — có thể nâng cấp sang
      `ArgumentNotProvidedException`/`ArgumentInvalidException` giờ đã có. Chưa làm ngay (đổi 4 file đã
      xong là loại thay đổi khác, cần hỏi ý kiến riêng — xem cuối phiên).
- [x] 0.7 — `src/core/context/request-context.js`. Thiết kế bất đối xứng có chủ đích: **đọc**
      (`getRequestId()`/`getTransactionSession()`) an toàn, trả `undefined` nếu ngoài
      `RequestContextService.run()` (không throw) — vì `DomainEvent`/`Command` phải tạo được ngoài
      HTTP request (cron job, script, test), chỉ thiếu `correlationId` chứ không được crash; **ghi**
      (`setRequestId`/`setTransactionSession`) vẫn throw qua `getContext()` nếu chưa `run()` — ghi vào
      context không tồn tại là lỗi setup thật, nên fail loud. Đã nối `correlationId` auto-fill vào
      `domain-event.base.js`/`command.base.js` (trả nợ từ task 0.4/0.5), ưu tiên giá trị truyền tay nếu
      có. Không có "pool getter tự động" như bản Postgres — Mongoose vẫn cần `{session}` truyền tường
      minh, `transactionSession` trong context chỉ để tránh phải luồn tham số qua nhiều lớp hàm, dùng ở
      task 0.10. Đã smoke test 13 case: auto-fill đúng trong context, không throw ngoài context, không
      rò rỉ giữa các `run()`, nested context độc lập, explicit value luôn thắng context, get/set/clear
      transaction session đúng.

      **Review vòng 2 (sau khi dùng thật):** phát hiện lỗ hổng thiết kế thật — `run()` lồng bên trong
      1 context đã có sẽ **thay thế hoàn toàn** store cũ (hành vi mặc định của `AsyncLocalStorage.run()`),
      làm mất `transactionSession` của outer 1 cách **silent** (không throw) — nếu task 0.10/Phase 1 lỡ
      gọi `run()` lồng để "mở thêm context con", session biến mất, query sau đó chạy ngoài transaction mà
      không ai biết. Sửa bằng cách thêm **`runChild(partialStore, callback)`** — merge với store hiện
      tại thay vì thay thế (field truyền tay override field kế thừa), dùng cho mọi trường hợp cần lồng
      thêm context (vd cron job phụ trong request). Đồng thời làm **`run()` throw ngay** nếu bị gọi khi
      đã có context sẵn — vì hiện tại không có nhu cầu hợp lệ nào cần "lồng nhưng cố tình không kế thừa",
      nên biến việc gọi nhầm method thành lỗi loud thay vì bug silent. **Đánh đổi đã chấp nhận, chưa giải
      quyết hết:** nếu sau này có nhu cầu thật "chạy 1 side-effect trong transaction tách biệt hoàn toàn,
      cố tình không kế thừa" (vd audit log không được làm rollback nghiệp vụ chính), thiết kế hiện tại
      chưa hỗ trợ — sẽ cần bàn lại lúc đó, không phải bây giờ. Đã re-run toàn bộ 15+ assertion (regression
      + case mới: `run()` lồng throw đúng, `runChild()` kế thừa `transactionSession`/`requestId` đúng,
      override tường minh thắng kế thừa, `runChild()` gọi ở top-level không có parent vẫn hoạt động,
      middleware task 0.8 không bị ảnh hưởng).
- [x] 0.8 — `src/middlewares/requestContextMiddleware.js` (mới, đặt ở `src/middlewares/` theo đúng
      convention có sẵn — `authMiddleware.js`, `loggingMiddleware.js` — không phải `src/core/`) +
      wire vào `index.js`, đặt **ngay sau `trust proxy`, trước mọi middleware khác** để toàn bộ
      downstream (rate limiter, `loggingMiddleware`, routes) đều nằm trong context. Đọc `x-request-id`
      header nếu có (khớp giá trị Traefik/hệ thống ngoài gửi), tự sinh (`crypto.randomUUID()`) nếu
      không. Chỉ đúng file `index.js` bị đụng trong Phase 0 (đúng dự kiến), không sửa
      `loggingMiddleware.js` (cơ chế `req.requestId` cũ của nó là việc riêng, ngoài phạm vi task này).
      Đã smoke test bằng Express + HTTP request thật (không phải gọi hàm trực tiếp): tự sinh id khi
      không có header, tôn trọng header có sẵn, 2 request đồng thời không lẫn context nhau.
- [x] 0.9 — **Quyết định bỏ, không tạo file.** Thử viết `mapper.interface.js`/`repository.port.js`
      (JSDoc-only contract) thì phát hiện: JS thuần không có `checkJs`/`jsconfig.json` nào bật để IDE
      thực sự dùng JSDoc typedef này — không tooling nào enforce, file chỉ mang tính tài liệu suông,
      dễ lệch khỏi code thật theo thời gian (stale doc). Giá trị thật của 2 file này (lý do dùng `null`
      thay vì `Option`/`Result`, lý do không có `transaction(handler)` chung như bản Postgres) sẽ ghi
      **ngay trong code thật** ở task 0.10 (`mongoose-repository.base.js`) và Phase 1
      (`request.mapper.js`/`request.repository.js`) khi có implementation cụ thể để đối chiếu — đúng
      tinh thần "không thêm abstraction khi chưa có gì dùng nó".
- [x] 0.10 — `src/core/db/mongoose-repository.base.js`. Khác biệt có chủ đích so với bản Postgres
      (`js/src/libs/db/sql-repository.base.js`):
      - **Không có `eventEmitter`/`publishEvents()` bên trong** — application service tự gọi
        `entity.publishEvents(eventBus)` sau khi `insert()`/`updateById()` xong (đúng theo thảo luận ở
        task 0.2: repository không sở hữu policy "publish fail có làm hỏng use-case chính không").
      - **`delete()` là soft-delete** (`isDeleted: true`), không xoá thật — đúng convention
        `CLAUDE.md`. Mọi read (`findOneById`/`findAll`/`findAllPaginated`) tự động lọc
        `isDeleted: false` — bake cứng vào base class để không ai quên.
      - **`findOneById` trả `null`** khi không thấy, không phải `Option`/`Result` — khớp style hiện có
        của `v-Work-API` (không dùng `oxide.ts`).
      - **Không có `transaction(handler)` chung** — application service tự mở
        `mongoose.startSession()`/`startTransaction()` (theo đúng `CLAUDE.md`), lưu vào context qua
        `RequestContextService.setTransactionSession()`; repository chỉ đọc lại qua getter
        `this.session` (không có `mongoose.Schema` trong file này — nhận Model đã build sẵn từ
        `src/models/*.js`, dùng chung cho mọi aggregate, không khoá cứng vào 1 collection).
      - Dùng `.lean()` cho mọi read — trả plain object, không cần hydrate Mongoose document đầy đủ vì
        chỉ dùng để map sang Entity.
      Review lint: `class-methods-use-this` trên getter `session` (tắt có chủ đích, giải thích trong
      comment) + 1 lỗi format prettier (multi-line query chain).
      **Đã smoke test bằng `MongoMemoryReplSet` thật** (không phải mock) — 20/20 case: insert/
      findOneById (thấy + không thấy)/findAll/findAllPaginated (count, limit, phân trang đúng)/
      updateById/soft-delete (document còn nguyên trong DB, `isDeleted:true`, không còn bị trả về nữa)/
      transaction (đọc thấy dữ liệu chưa commit trong cùng transaction, dữ liệu tồn tại sau commit,
      **rollback đúng khi abort — dữ liệu không được lưu**)/hoạt động bình thường khi không có
      transaction session nào active. Áp dụng luôn fix `Model.init()` trước khi test transaction (tránh
      race condition autoIndex đã ghi nhận trước đó trong `docs/REQUEST-RBAC-PLAN.md` của chính dự án).
      **Lưu ý khi review:** lần chạy đầu có 1 case fail ("thấy dữ liệu chưa commit trong transaction") —
      xác nhận đây là bug ở **mapper của test script** (quên gán `_id: props.id` khi `toPersistence()`,
      khiến `entity.id` không khớp `_id` thật của document), không phải bug ở
      `mongoose-repository.base.js` — sau khi sửa mapper test, pass toàn bộ. Đây cũng là điểm nhắc quan
      trọng cho mapper thật ở Phase 1: **`toPersistence()` phải luôn gán `_id: props.id`**, nếu không
      `entity.id` sẽ không khớp document thật.
- [x] 0.11 — 8 file test Jest chính thức tại `__tests__/core/` (chuyển từ smoke test `node -e` tạm ở
      các task trước thành test permanent, chạy qua `npm test`): `entity`, `aggregate-root`,
      `value-object`, `domain-event`, `command`, `exceptions`, `request-context` (không cần DB) +
      `mongoose-repository` (dùng `MongoMemoryReplSet` thật, đúng convention dự án —
      `beforeAll(..., 60000)` + `model.init()` fix race autoIndex, giống `requestApprovalFlow.test.js`).
      **74/74 test pass.**

      Review lint: `max-classes-per-file` (2 file test có nhiều class fixture nhỏ — tắt có chủ đích,
      giống cách xử lý ở `exceptions.js` task 0.6) + `class-methods-use-this` trên `validate()` không
      dùng `this` + `no-promise-executor-return`.

      **Phát hiện 1 vấn đề thật khi test `aggregate-root.base.js`:** `new AggregateRoot(...)` trực
      tiếp throw đúng (chặn được misuse) nhưng **sai message** — `super()` bắt buộc chạy trước trong
      constructor con, mà `Entity.constructor` gọi `this.validate()` ngay trong `super()`;
      `AggregateRoot` không override `validate()` nên luôn dính lỗi "validate() chưa implement" **trước
      khi** chạm tới check `new.target === AggregateRoot` của chính nó. Không phải bug chức năng (vẫn
      throw, vẫn chặn được), nhưng message gây hiểu lầm (gợi ý sai hướng sửa). Đã sửa test để assert
      đúng hành vi thật, ghi rõ lý do trong comment — chưa sửa `aggregate-root.base.js` vì đây là giới
      hạn cố hữu của thứ tự gọi constructor trong JS, không có cách nào đổi thứ tự given `super()` phải
      chạy đầu tiên.

      **Chạy `npm test` toàn repo phát hiện 4 suite lỗi có sẵn từ trước, KHÔNG liên quan Phase 0** —
      `attendanceMerge.test.js`, `approvalChain.test.js`, `forgotCheckinApprove.test.js`,
      `requestApprovalFlow.test.js`. Đã verify kỹ trước khi kết luận (không đoán bừa):
      - `git status` xác nhận **không đụng file nào** mà 4 suite này phụ thuộc
        (`attendanceHelper.js`, `approvalChain.js`, `helpers/rbac.js`, `RequestController.js`).
      - Fail cả khi chạy riêng lẻ từng suite (không phải resource contention khi chạy song song).
      - `forgotCheckinApprove.test.js`: dùng `MongoMemoryServer` (không phải `MongoMemoryReplSet`) mà
        code bên trong lại mở transaction → `MongoServerError: Transaction numbers are only allowed on
        a replica set member or mongos` — lỗi setup có sẵn từ trước, không phải do Phase 0.
      - `attendanceMerge.test.js`/`approvalChain.test.js`: fail ở assertion nghiệp vụ cụ thể (nghi ngờ
        liên quan tới ngày/giờ hoặc business logic đã đổi từ lúc viết test — **chưa điều tra sâu, ngoài
        phạm vi Phase 0, không tự sửa vì không đủ context về nghiệp vụ**).
      **Không sửa 4 suite này** — không thuộc phạm vi DDD/Hexagonal migration, cần bạn tự xem lại hoặc
      giao riêng.

**Phase 0 hoàn tất — toàn bộ code mới (0.1-0.11) test pass, không gây regression cho suite cũ.**

**Definition of done:** `npm test` xanh, `npm run lint` sạch, không file nào ngoài `src/core/` và
`__tests__/core/` bị đụng (trừ 0.8).

### 6b. Nâng cấp guard exception ở 0.1-0.5 (sau khi 0.6 xong)

Sau khi có `exceptions.js`, quay lại 4 file đã xong (`entity.base.js`, `value-object.base.js`,
`domain-event.base.js`, `command.base.js`) để đổi `throw new Error(...)` cho các guard input rỗng/sai
sang đúng exception thật (`ArgumentNotProvidedException`/`ArgumentInvalidException`). **Cố tình KHÔNG
đổi** 2 chỗ: "instantiate abstract class trực tiếp" và "chưa implement `validate()`" — đây là lỗi lập
trình/kiến trúc (dùng sai class), nên crash ngay lúc dev bằng `Error` thường, không phải exception
nghiệp vụ cần `statusCode`/`correlationId` cho response API. Đã smoke test lại toàn bộ 5 file: construct
hợp lệ không đổi hành vi, guard lỗi giờ đúng loại exception mới (có `code`/`statusCode`), lỗi lập trình
vẫn là `Error` thường như cũ.

## 7. Phase 1 — Pilot: module `request` (bản sửa sau khi đọc code thật)

Chọn `request` làm thí điểm vì đã có test tốt (`approvalChain.test.js`, `requestApprovalFlow.test.js`,
`requestControllerCreate.test.js`) — test cũ là lưới an toàn khi đổi cấu trúc.

**Sửa lại so với bản lập lúc đầu:** danh sách 1.1-1.13 cũ lập dựa trên tóm tắt trong
`REQUEST-RBAC-PLAN.md`/`REQUEST-APPROVAL-CHAIN-PLAN.md`, chưa đọc `RequestController.js`/
`RequestModel.js`/`approvalChain.js`/`requestUtils.js` thật. Đọc code thật phát hiện độ phức tạp lớn
hơn nhiều:
- `RequestModel` dùng **Mongoose discriminator** — 7 loại đơn (`leave`, `late_early`, `remote`,
  `business_trip`, `client_visit`, `explanation`, `forgot_checkin`), mỗi loại schema riêng + **1
  handler riêng** (`leaveHandler`, `lateEarlyHandler`...) với 5 hook (`validate`, `validateAsync`,
  `onCreate`, `onApprove`, `onReject`).
- Rule "cần 2 người duyệt" có **3 ngưỡng khác nhau** theo loại đơn: `leave` (`total_days > 3`),
  `forgot_checkin` (`occurrence >= 6`), `late_early` (`occurrence >= 4`) — không chỉ riêng `leave`.
- Redis lock (`acquireRequestReviewLock`) phải acquire **trước** khi mở Mongo transaction (snapshot
  isolation).
- Notification fan-out nhiều nhánh (duyệt 1/2, duyệt xong, từ chối), broadcast HR + quản lý gần nhất,
  dedupe, loại trừ chính người duyệt.

**Quyết định:** giữ nguyên phạm vi đầy đủ (không cắt bớt loại đơn/action nào), nhưng chia nhỏ theo
**từng action** (mỗi action = 1 vertical slice hoàn chỉnh: domain liên quan → application service →
interface → cutover route → verify), thay vì chia theo tầng (domain xong hết → infra xong hết...) như
bản cũ — vì mỗi action có độ rủi ro/độ phức tạp khác nhau, cần review độc lập. 7 handler theo loại đơn
(`leaveHandler`...) **giữ nguyên, không đụng** — tiếp tục đóng vai trò Domain Service, được gọi từ
Application Service, đúng pattern đã áp dụng cho `helpers/approvalChain.js`/`helpers/rbac.js`.

### Nền tảng domain + infrastructure (xây 1 lần, chưa đổi route nào)

- [x] 1.1 — `domain/request.entity.js`: entity CHUNG cho cả 7 loại (`user_id`, `status`, `reason`,
      `reviewed_by`, `reviewed_at`, `reviewer_note`, `approvals`, `request_type` + field type-specific
      lưu trong `props` linh hoạt). `id` sinh bằng `mongoose.Types.ObjectId()` (không phải
      `crypto.randomUUID()` như bản `js/` mẫu) — bắt buộc vì `RequestModel._id` là `ObjectId`, đánh đổi
      có ý thức với Hexagonal thuần tuý, đã ghi rõ trong comment. Invariant: không tự duyệt đơn mình
      (`_assertNotSelfReview`), trạng thái hợp lệ (`validate()` dùng `ArgumentInvalidException` chung
      — lỗi cấu trúc dữ liệu) tách biệt với sai trạng thái chuyển đổi (`_assertPending()` dùng
      `InvalidStatusTransitionError` riêng — lỗi quy tắc nghiệp vụ), không duyệt 2 lần cùng 1 người
      (`AlreadyReviewedError`), method `needsMultiApproval()` theo đúng 3 ngưỡng (leave/forgot_checkin/
      late_early). **Chi tiết dễ bỏ sót đã port đúng:** `reject()` LUÔN xong ngay 1 phát bất kể loại
      đơn/ngưỡng — khớp code gốc vì `needsMultiApproval` chỉ tính khi `action === "approve"`. Entity
      KHÔNG check authorization (`canReviewAll`/trong chuỗi duyệt) — đó là việc của application service
      (task 1.12/1.13), gọi RBAC/approvalChain trước khi gọi `entity.approve()`. Đã smoke test 24 case
      (create, approve đơn giản, self-review, duyệt khi không còn pending, đa duyệt 1/2 và 2/2, duyệt
      trùng người, reject luôn xong ngay, cancel, đủ 3 ngưỡng đa duyệt, validate status sai).

      **Phát hiện nghiệp vụ có sẵn, NGOÀI PHẠM VI migrate (không tự sửa):** trong nhánh đa duyệt, mỗi
      phần tử `approvals` chỉ lưu `{account, reviewed_at}` — **không lưu `reviewer_note` của người
      duyệt đầu tiên**. `reviewed_by`/`reviewer_note` ở top-level chỉ phản ánh đúng người duyệt **cuối
      cùng** (người thứ 2) — note của người duyệt thứ nhất bị mất hoàn toàn, dù họ có gửi trong request
      body. Xác nhận đây là hành vi có sẵn trong `RequestController.js` gốc (dòng 452, 456-458), không
      phải bug do migrate gây ra — đã port lại chính xác. Nếu muốn sửa (lưu note theo từng người duyệt,
      đổi shape `approvals` thành `{account, reviewed_at, note}`), đây là **thay đổi hành vi có chủ
      đích, cần làm thành 1 task riêng**, không trộn vào việc đổi cấu trúc lần này.

      **Phát hiện nghiệp vụ thứ 2 (cùng nguồn gốc — `needsMultiApproval` chỉ tính khi `action ===
      "approve"`):** không có gì chặn 1 đơn **đã được duyệt 1/2** (còn `pending`, chờ người thứ 2) bị
      **reject ngay lập tức** bởi bất kỳ ai có quyền review — kể cả chính người vừa duyệt — bỏ qua hoàn
      toàn approval đã ghi nhận trước đó, không cảnh báo, không lỗi. Nguyên nhân: code gốc
      (`RequestController.js` dòng 356-360) tính `needsMultiApproval = action === "approve" && (...)`
      — khi `action === "reject"`, biến này luôn `false` bất kể loại đơn/ngưỡng, nên đi thẳng vào nhánh
      `request.status = action === "approve" ? "approved" : "rejected"` mà **không hề kiểm tra
      `request.approvals.length`**. `RequestEntity.reject()` đã port lại đúng y hệt hạn chế này (không
      check `approvals.length`/`needsMultiApproval()`, chỉ `_assertPending()` + `_assertNotSelfReview()`).
      Không tự sửa — nếu muốn chặn (vd: đã có ≥1 approval thì reject phải yêu cầu xác nhận, hoặc chỉ
      người trong `approvals` mới được reject phần còn lại), đây cũng là **thay đổi hành vi có chủ đích,
      cần task riêng**, ngoài phạm vi lần migrate này.

      **Cập nhật (task 1.12) — phạm vi ảnh hưởng rộng hơn đã ghi ban đầu, không chỉ dữ liệu domain:**
      viết xong `review-request.service.js`/`notifyAfterReview()` mới thấy rõ gap này còn lộ ra ở
      **tầng notify**, không chỉ tầng dữ liệu — khi 1 đơn đã duyệt 1/2 bị reject, `notifyAfterReview`
      (nhánh `action === "reject"`, `isFinal`) chỉ nhắc tới `reviewerInfo.full_name` (người vừa reject),
      **không hề đề cập** người đã approve (1/2) trước đó — thông tin approval trước bị bỏ qua hoàn
      toàn cả ở dữ liệu lẫn nội dung thông báo gửi cho nhân viên/broadcast. Vẫn là câu hỏi nghiệp vụ
      treo, chưa quyết định sửa hay giữ nguyên — nhắc lại ở đây vì giờ thấy rõ mức độ ảnh hưởng thật
      (không chỉ lý thuyết) lớn hơn ban đầu tưởng.

      **Bug thật do chính mình tạo ra (không phải port từ code gốc) — đã sửa ngay, không phải nợ:**
      thiết kế ban đầu của `request.mapper.js` (task 1.4) có `TYPE_SPECIFIC_FIELDS` chỉ lọc field lúc
      **đọc** (`toDomain`), còn lúc **ghi** (`toPersistence`) lại spread nguyên `entity.getProps()`
      không lọc gì cả — tạo cảm giác an toàn giả ("chỉ field đúng loại mới lưu được") nhưng thực tế nếu
      có bug ở chỗ khác (vd application service task 1.11 lỡ gán nhầm field `minutes` — vốn chỉ thuộc
      `late_early` — vào 1 đơn `leave`), `toPersistence` vẫn ghi xuống Mongo bình thường, không ai biết.
      **Sửa đúng chỗ:** thay vì lọc ở mapper (chỉ che giấu bug, field sai "biến mất" âm thầm không ai
      hay), chuyển field list (`REQUEST_TYPE_FIELDS`) sang sống ở `request.entity.js` (đây là domain
      knowledge, không phải chuyện Mongoose) và bắt `validate()` của Entity **chặn ngay** field lạ không
      thuộc `request_type` hiện tại — lỗi loud (`ArgumentInvalidException`) ngay lúc gán, không phải
      silent drop lúc ghi DB. `request.mapper.js` giờ `require` field list từ entity thay vì tự giữ bản
      sao riêng (tránh lệch 2 nơi). Đã test lại: field sai loại (`minutes` vào `leave`, `total_days`
      vào `late_early`) đều bị chặn đúng; cả 7 discriminator với field đúng loại không bị chặn nhầm;
      toàn bộ 14 case entity + 4 case mapper trước đó vẫn pass, không regression.
- [x] 1.2 — `domain/request.errors.js`: `CannotSelfReviewError` (403), `AlreadyReviewedError` (409),
      `InvalidStatusTransitionError` (409), `RequestNotFoundError` (404) — cùng pattern `exceptions.js`
      (gộp nhiều class nhỏ 1 file, `max-classes-per-file` tắt có chủ đích). Đã smoke test: đúng
      code/statusCode/message mặc định, đều `instanceof ExceptionBase`.
- [x] 1.3 — `domain/events/` (làm trước 1.1 vì entity phụ thuộc, xem ghi chú đầu mục 7):
      `RequestCreatedDomainEvent`, `RequestPartiallyApprovedDomainEvent` (duyệt 1/2 — tách riêng khỏi
      Approved vì nội dung/người nhận thông báo khác hẳn), `RequestApprovedDomainEvent` (dùng chung cho
      cả nhánh duyệt 1 lần lẫn duyệt lần 2/2 — tầng thông báo không cần biết đơn thuộc loại đa duyệt
      hay không), `RequestRejectedDomainEvent` (thêm field `reviewerNote` mà Approved không có),
      `RequestCancelledDomainEvent` (lưu ý: code hiện tại KHÔNG gửi thông báo khi huỷ đơn — event vẫn
      tạo để đầy đủ domain fact, nhưng task 1.14 sẽ không cần wire handler cho event này trừ khi chủ
      động đổi hành vi). Đã smoke test cả 5 event: đúng field, đều là `DomainEvent`, mỗi event có `id`
      riêng biệt.
- [x] 1.4 — `infrastructure/request.mapper.js`: xử lý đúng cả 7 shape discriminator qua
      `TYPE_SPECIFIC_FIELDS` (đọc `request_type` để biết field phụ nào cần lấy — `remote`/
      `business_trip`/`client_visit` giống hệt nhau nên dùng chung 1 danh sách field). `toDomain` strip
      `_id` của Mongoose subdocument trong `approvals` (Mongoose tự thêm, không phải phần của domain).
      `toPersistence` cố tình loại `createdAt`/`updatedAt` khỏi output (để `BaseSchema.timestamps`
      tự quản lý, tránh ghi đè bằng giá trị cũ mỗi lần update) — `isDeleted` **không cần cộng tay**, đã
      có sẵn trong `getProps()` (do `Entity` base gộp cùng `id/createdAt/updatedAt` — xem review vòng 2
      dưới). Reconstitution dùng `{ validate: false }` giống pattern đã dùng ở các file trước.

      **Review vòng 2:** bị hỏi liệu `isDeleted` có bị mất khi `toPersistence` không cộng tay — verify
      bằng test thật (không chỉ suy luận): `getProps()` ở `entity.base.js` (task 0.1) trả về
      `{id, createdAt, updatedAt, isDeleted, ...this.props}` — `toPersistence` chỉ destructure bỏ 3
      field `id/createdAt/updatedAt`, `isDeleted` tự động còn lại trong phần spread. Đã test 15 case
      xác nhận: `isDeleted` sống sót round-trip kể cả sau `markAsDeleted()`, `approvals` strip đúng
      `_id` subdocument, cả 7 discriminator giữ đúng field type-specific qua round-trip.
- [x] 1.5 — `infrastructure/request.repository.js`: extends `MongooseRepositoryBase`, override
      `insert`/`updateById` để ghi qua đúng discriminator model tương ứng (`LeaveRequest`/
      `LateEarlyRequest`...) dựa theo `entity.requestType` — đọc (`findOneById`/`findAll`...) giữ
      nguyên từ base class, không override, vì `.lean()` trả đúng dữ liệu thật đã lưu bất kể query qua
      model nào.

      **Lý do bắt buộc phải chọn đúng discriminator model khi ghi:** Mongoose chỉ áp dụng cast/validate
      của field riêng từng loại (`leave_type` required của `LeaveRequest`...) khi gọi qua chính model
      discriminator đó — gọi `RequestModel.create()`/`findOneAndUpdate()` trực tiếp (model gốc) sẽ bỏ
      qua toàn bộ validation riêng của loại đơn, dù cùng 1 collection MongoDB.

      **Đã verify bằng test thật** (`__tests__/modules/request/request.repository.test.js`, dùng
      `MongoMemoryReplSet` + `model.init()` fix race giống các test trước) — không chỉ suy luận:
      - `insert()` qua `LeaveRequest` lưu đúng field discriminator (`leave_type`, `total_days`...).
      - `insert()` một `leave` request **thiếu `leave_type`** (field required riêng của discriminator)
        bị MongoDB **từ chối thật** — chứng minh write thực sự đi qua model discriminator, không phải
        model gốc lỏng lẻo.
      - `findOneById()` map đúng về `RequestEntity` đầy đủ field type-specific.
      - `updateById()` qua discriminator model ghi đúng thay đổi domain (`approve()` → `status:
        "approved"`) và **giữ nguyên** field discriminator-specific (`leave_type`) không bị mất.
      - `_modelFor()` chọn đúng model theo `request_type`.
      5/5 test pass. `node --check` + `eslint` sạch. Chạy lại toàn bộ `npm test`: 251 pass, 17 fail —
      đúng 4 suite đã biết từ Phase 0 (`attendanceMerge`, `approvalChain`, `forgotCheckinApprove`,
      `requestApprovalFlow`), xác nhận qua `git status` không đụng file nào các suite này phụ thuộc —
      **task 1.5 không gây regression nào**.

      **Thảo luận thêm (không phải việc phải sửa, ghi lại vì có giá trị tham khảo):** repository hiện
      tại ghi bằng cách gọi `toPersistence()` → thay thế toàn bộ document (`findOneAndUpdate` full
      replace), không dùng operator atomic của Mongo (`$push`, `$inc`, `updateMany`). Cụ thể với
      `approve()` đa duyệt: entity tính `approvals` mới trong bộ nhớ rồi ghi đè cả mảng, thay vì
      `$push` 1 phần tử — nếu không có Redis lock (`acquireRequestReviewLock`, sẽ port ở task 1.13)
      chặn 2 reviewer ghi đồng thời, đây sẽ là lost-update race thật. Lock hiện có + full-replace hoạt
      động đúng như một cặp bổ sung nhau — **task 1.13 bắt buộc phải giữ nguyên lock**, không được bỏ
      dù trông "thừa" so với cách viết generic này.

### Action đọc (rủi ro thấp — mỗi task: service + interface + cutover route)

- [x] 1.6 — `getEligibleReviewers`: `application/get-eligible-reviewers.service.js` gọi thẳng
      `UserInfoModel`/`getApprovalChain` (application → infrastructure trực tiếp, không thêm port —
      quyết định giữ gọn cho action đơn giản, đã bàn kỹ ở "Cách làm việc"); `interface/` giờ có
      `request.http.controller.js` (handler mỏng, không tự try/catch) + `request.routes.js` (route
      định nghĩa chuyển hẳn vào module — xem case cụ thể ở "Cách làm việc"). Đã cutover route thật:
      `src/routes/index.js` require thẳng `modules/request/interface/request.routes.js`, xoá
      `src/routes/request.js` cũ. Thêm 3 file `core/http/` dùng chung (không riêng module này):
      `handle-exception.js`, `error-handler.middleware.js`, `async-handler.js`; wire global error
      middleware vào `index.js` (sau `route(app)`).

      **Đã test đầy đủ, không chỉ suy luận:** `node --check` + `eslint` sạch trên toàn bộ 7 file
      đụng tới. Test HTTP end-to-end thật (`__tests__/modules/request/eligible-reviewers.http.test.js`,
      dựng app Express thật mount `request.routes.js` + `errorHandlerMiddleware`, `MongoMemoryServer`
      thật cho `UserInfoModel`) — 3/3 pass: 200 trả `{message, data}` đúng khi có userInfo (chain rỗng
      → `data: null`), 404 `{message}` khi không có userInfo (chứng minh lỗi throw từ service tự
      propagate qua `asyncHandler` → `next(err)` → global middleware, không cần try/catch thủ công),
      401 khi chưa đăng nhập (hành vi `authenticate` không đổi). Chạy lại `node -e` xác nhận
      `src/routes/index.js` (đụng tới, dùng chung mọi module) vẫn require thành công toàn bộ ~30 router.
      Toàn bộ `npm test`: 254 pass / 17 fail — đúng 4 suite pre-existing đã biết từ Phase 0, không có
      regression mới (251→254 vì +3 test mới, số fail giữ nguyên 17).
- [x] 1.7 — `getMyRequests`: `application/get-my-requests.service.js` đọc thẳng `RequestModel` (không
      qua Entity, đúng CQRS-lite), cố tình **không** `.lean()` — giữ nguyên hành vi gốc dựa vào
      `toJSON()` của `BaseSchema` để format `createdAt`/`updatedAt` theo giờ VN, thêm `.lean()` sẽ đổi
      shape response. `VALID_TYPES` không tự định nghĩa lại — lấy từ `Object.keys(REQUEST_TYPE_FIELDS)`
      (export từ `request.entity.js`) để tránh lặp lại đúng loại bug đã sửa ở task 1.4 (2 nơi giữ cùng 1
      danh sách, dễ lệch nhau). `interface/request.http.controller.js` + `request.routes.js` (`GET /my`)
      cập nhật theo mẫu 1.6.

      **Bug thật phát hiện khi review (không phải do migrate — có sẵn ở `RequestController.js` gốc dòng
      155-156), đã QUYẾT ĐỊNH SỬA (khác các phát hiện nghiệp vụ trước — xem lý do dưới):**
      `page`/`limit` không validate gì — `Number(page)`/`Number(limit)` khi client gửi giá trị không
      phải số (`page=abc`) ra `NaN`. Verify thật bằng `MongoMemoryServer` (không suy luận): Mongo
      **im lặng bỏ qua** `skip(NaN)`/`limit(NaN)` (không throw) — nghĩa là `limit=abc` biến thành
      **query không giới hạn**, trả về toàn bộ document khớp filter; `limit` âm (vd `-1`) cũng không lỗi
      nhưng hành vi lạ (Mongo hiểu là "đóng cursor sau 1 batch", chỉ trả đúng 1 document, không phải
      "không giới hạn" như tưởng); `limit=99999` không bị chặn, trả thật 99999 document nếu tồn tại.

      **Lý do sửa ngay thay vì chỉ note lại (khác cách xử lý 2 phát hiện nghiệp vụ ở task 1.1):** đây
      không phải business rule (không ai "thiết kế" hành vi này), mà là lỗ hổng kỹ thuật thuần —không có
      version hành vi nào của nó là "đúng" để buộc phải giữ tương thích ngược. Rủi ro tăng dần khi cùng
      pattern lặp lại ở 1.8 (`getAll`, không scope theo user — dễ kéo cả bảng công ty) nên xử lý dứt điểm
      1 lần bằng helper dùng chung, đỡ phải sửa rải rác 3 chỗ. **Đã hỏi và được xác nhận chọn "sửa luôn,
      dùng chung 3 action"** trước khi làm (không tự ý quyết).

      **Fix:** thêm `core/http/parse-pagination.js` — `parsePagination(query)` dùng chung (không riêng
      module `request`), trả `{page, limit, skip}` đã clamp: `page` phải là số nguyên `>= 1` (fallback
      `1`), `limit` phải là số nguyên `>= 1` và bị giới hạn trần `MAX_LIMIT = 100` (fallback `20` nếu
      input không phải số nguyên hợp lệ). Dùng lại cho 1.8/1.9 khi tới lượt.

      **Test:** `__tests__/core/parse-pagination.test.js` — 8 case (default, `NaN` page/limit, limit âm,
      limit vượt trần, page=0/âm, page không nguyên, input hợp lệ) đều pass, cộng smoke test bằng
      `node -e` xác nhận trước khi viết Jest test chính thức.
      `__tests__/modules/request/get-my-requests.http.test.js` — 7 case qua HTTP thật (scope đúng user,
      filter `request_type` hợp lệ, populate `reviewed_by`, 404 không có `user_info`, 3 case pagination
      edge — `limit=abc` không còn unbounded, `limit=99999` bị clamp 100, `page=abc` không throw). Tổng
      15 test mới, tất cả pass. Toàn bộ `npm test`: 269 pass / 17 fail — vẫn đúng 4 suite pre-existing đã
      biết, không regression mới.

      **Bug thật thứ 2 phát hiện sau khi review (cũng có sẵn ở code gốc dòng 159, cùng bản chất kỹ thuật
      như bug pagination — không phải business rule, sửa ngay không cần hỏi lại):**
      `if (request_type && VALID_TYPES.includes(request_type)) filter.request_type = request_type;` —
      khi `request_type` client gửi lên KHÔNG hợp lệ (typo, hoặc giá trị cũ FE đã bỏ), điều kiện
      `false` khiến **filter bị bỏ qua âm thầm**, trả về TẤT CẢ loại đơn thay vì báo lỗi hoặc trả rỗng —
      client tưởng đang lọc theo `request_type=xyz` nhưng thực ra nhận full list, dễ gây hiểu nhầm lúc
      debug ("sao filter không có tác dụng?"). Khác `status` (client gửi status sai chỉ khớp 0 document,
      trả rỗng đúng nghĩa — không có bug tương tự vì `status` không có whitelist gate trước khi gán).

      **Fix:** thêm `application/request-query-filters.js` — `applyRequestTypeFilter(filter,
      requestType)` dùng chung cho `request` module (1.7 và 1.8 khi tới lượt): không làm gì nếu
      `requestType` rỗng; throw `ArgumentInvalidException` (400) nếu có giá trị nhưng không thuộc
      `VALID_TYPES`; gán filter nếu hợp lệ. `VALID_TYPES` vẫn lấy từ `REQUEST_TYPE_FIELDS` (domain), gom
      về 1 chỗ duy nhất thay vì định nghĩa lại ở từng service.

      **Test:** `__tests__/modules/request/request-query-filters.test.js` (4 case: no-op khi rỗng, gán
      đúng khi hợp lệ, throw 400 khi sai, `VALID_TYPES` khớp đúng 7 discriminator) +
      cập nhật lại test HTTP cũ (case "bỏ qua request_type không hợp lệ" đổi thành "400 khi request_type
      không hợp lệ" — sửa test này hợp lệ vì đây là test do chính lần migrate viết ra vài phút trước,
      không phải "test cũ" theo nghĩa nguyên tắc bảo vệ test tiền-migration). Tổng 12 test (8 mới + 4
      cũ đã sửa), tất cả pass. `npm test` toàn repo: 274 pass / 17 fail — vẫn đúng 4 suite pre-existing.

      **Bug thật thứ 3 phát hiện (cũng có sẵn ở code gốc dòng 161-164, nghiêm trọng hơn 2 cái trước —
      không phải trả sai kết quả mà THROW LỖI KHÔNG BẮT):** `moment.tz(from, TZ).startOf("day").toDate()`
      — nếu `from`/`to` là chuỗi không parse được (vd `"invalid-date"`), `moment` **không throw**, chỉ trả
      về `Invalid Date` (đối tượng `Date` hợp lệ nhưng `getTime()` là `NaN`), code cũ gán thẳng giá trị
      này vào `filter.createdAt.$gte/$lte` mà không kiểm tra `isValid()`. Verify thật bằng
      `MongoMemoryServer` (không suy luận): Mongoose **throw `CastError`** khi query với Invalid Date
      (`Cast to date failed for value "Invalid Date" ... at path "createdAt" for model "T"`) — lỗi này
      không phải `ExceptionBase`, nên rơi vào nhánh 500 của `sendExceptionResponse`, nghĩa là 1 lỗi input
      của client (gửi `from` sai định dạng) hiện đang trả về **500 Internal Server Error** (sai status
      code — đáng lẽ 400) và **lộ tên field + tên model** trong `error.message` ra ngoài response.

      **Fix:** thêm `applyDateRangeFilter(filter, from, to)` vào cùng `request-query-filters.js` — gọi
      `moment.tz(...).isValid()` trước khi `.toDate()`, throw `ArgumentInvalidException` (400) với message
      rõ ràng nếu không hợp lệ, thay vì để Invalid Date lọt xuống tầng Mongoose. Gộp luôn hằng số `TZ`
      vào file này (trước đó bị định nghĩa trùng ở `get-my-requests.service.js`), `get-my-requests.service.js`
      giờ chỉ gọi `applyDateRangeFilter`, không tự xử lý ngày tháng nữa.

      **Test:** thêm 4 case cho `applyDateRangeFilter` (no-op khi rỗng, gán đúng khi hợp lệ, throw 400
      khi `from`/`to` không parse được) + 1 case HTTP end-to-end xác nhận `from=invalid-date` trả về 400
      với message rõ ràng, không còn 500 lộ chi tiết nội bộ. Tổng 5 test mới, tất cả pass. `npm test`
      toàn repo: 279 pass / 17 fail — vẫn đúng 4 suite pre-existing, không regression mới.

      **Swagger lệch thực tế (phát hiện do user báo), đã sửa:** `src/docs/request.yaml` mục
      `/requests/my` gốc gần như trống — không khai báo `query params` nào
      (`request_type/status/from/to/page/limit`), thiếu cả `404`. Đã bổ sung đầy đủ params (kèm `enum`
      đúng 7 request_type + 4 status), mô tả rõ hành vi fallback của `page/limit` (task 1.7) và `400`
      mới (2 fix vừa làm). Verify bằng cách `require("./src/config/swagger")` thật — lần đầu bị
      `YAMLSemanticError` vì description `200` chứa `{ total, page... }` lồng trong flow-map khiến YAML
      hiểu nhầm là map con; sửa bằng cách chuyển 2 response description dài sang block-style (key xuống
      dòng) thay vì flow-map 1 dòng. Xác nhận lại: load đủ 192 path, không vỡ path nào khác. File này
      vốn đã không qua `prettier` từ trước khi tôi sửa (kiểm tra bằng `git stash` + `prettier --check`)
      — không ép format lại toàn file, chỉ sửa đúng phần nội dung liên quan.
- [x] 1.8 — `getAll`: đọc thẳng `RequestModel` (không qua Entity), tái dùng nguyên
      `applyRequestTypeFilter`/`applyDateRangeFilter`/`parsePagination` từ 1.7.

      **Thảo luận thiết kế RBAC (trước khi viết code) — 3 solution đã cân nhắc:**
      (A) imperative rải trong service — đơn giản nhất, đúng y hệt code gốc; (B) tách hàm thuần
      `resolveRequestViewScope(account)` dùng chung — DRY vừa đủ, test độc lập không cần OOP; (C)
      Domain Policy/Specification class — ceremony thừa vì rule chỉ 3 nhánh phẳng, không cần đa hình
      hay compose nhiều rule. **Chọn B theo yêu cầu người dùng**, dù đã khuyến nghị chờ đọc code gốc
      `getById` (1.9) trước khi tách — quyết định tách ngay, chấp nhận rủi ro nếu 1.9 hoá ra không cùng
      shape (dùng `getApprovalChain` thay vì `getManagedUserIds`) thì **tách riêng, không ép dùng
      chung**, không coi B là ép buộc cho mọi action đọc sau này.

      **`application/resolve-request-view-scope.js`** (Solution B): `resolveRequestViewScope(account)`
      trả `{type: "all", myUserInfo}` (view_all) hoặc `{type: "managed", userIds, myUserInfo}`
      (review-only, scope qua `getManagedUserIds`), throw `ForbiddenException` (403 — class mới, thêm
      vào `core/exceptions/exceptions.js`, chưa tồn tại trước đó) nếu không có quyền nào, throw
      `NotFoundException` (404) nếu có quyền review nhưng thiếu `myUserInfo`.

      **2 review vòng 2 quan trọng trên chính resolver này:**
      1. *Nghi ngờ ban đầu:* `myUserInfo` bị query vô điều kiện, kể cả nhánh "all" — tưởng là query
         thừa/không rõ mục đích. **Verify lại code gốc (dòng 246-248) xác nhận KHÔNG THỪA** —
         `myUserInfo` được dùng ở CẢ 2 nhánh để loại trừ đơn của chính người gọi khỏi danh sách (kể cả
         khi xem "tất cả"). Đã thêm comment giải thích rõ trong code, tránh người đọc sau hiểu nhầm rồi
         "dọn" sai gây regression thật (trả `null` cho nhánh "all" sẽ làm admin/HR có hồ sơ nhân viên +
         từng tạo đơn nhìn thấy đơn của chính mình trong "xem tất cả" — sai khác hành vi gốc).
      2. Message 404 gốc `"Không tìm thấy thông tin quản lý"` gây hiểu lầm (điều kiện thật là thiếu
         `myUserInfo` **của chính người gọi**, không phải "thông tin quản lý" của ai khác) — đổi thành
         `"Không tìm thấy thông tin nhân viên"`, tái dùng đúng message đã dùng ở 1.6/1.7 cho cùng điều
         kiện, thay vì tạo biến thể thứ 3 (code gốc vốn đã có 2 message khác nhau cho cùng 1 điều kiện
         giữa các action — không nhất quán từ trước, gom về 1 message khi đã centralize logic).

      **Bug thật thứ 4 phát hiện (khác 3 bug trước — không phải input dạng số/ngày mà là dạng text tự
      do, `search`):** code gốc `$regex: search` dùng thẳng input người dùng không escape. Verify thật
      bằng `MongoMemoryServer`: search chứa ký tự regex đặc biệt (`(`, `[`, `*`, `\`) làm MongoDB
      **throw `MongoServerError`** ("Regular expression is invalid...") — **dễ gặp trong thực tế hơn cả
      3 bug trước** vì tên/ghi chú thật chứa dấu ngoặc là chuyện bình thường (vd "Nguyễn A (CN2)").
      **Fix:** `buildUserNameSearchFilter(search)` trong `request-query-filters.js`, dùng
      `escapeRegExp` từ `lodash` (deep-import `lodash/escapeRegExp`, đã có sẵn dependency, đúng convention
      đã chốt — không thêm gói mới). Verify lại: search `"(CN2)"` khớp đúng theo nghĩa literal, không
      còn crash.

      **Thảo luận thêm (đã trả lời, không phải việc phải sửa):**
      - Xác nhận `can()` ở `helpers/rbac.js` đúng vai trò Domain Service theo mục 3 của plan (dùng
        chung nhiều aggregate, không thuộc riêng `Request`) — giữ nguyên vị trí, không di chuyển.
      - Lo ngại gọi `can()` 2 lần liên tiếp (view_all rồi review) tốn 2 round-trip DB — **verify thật
        bằng spy trên `UserRoleModel.find`: chỉ 1 lần gọi Mongo thực sự**, vì `getEffectivePermissions()`
        đã cache theo Redis (`RBAC_CACHE_TTL = 60s`) — lần gọi thứ 2 hit cache ấm, không phải bug hiệu
        năng, và đây cũng là pattern y hệt code gốc, không phải do migrate.
      - `requirePermission()` (middleware boolean đơn giản, dùng ở 12 route khác) khác với
        `resolveRequestViewScope` (tính toán scope dữ liệu, không phải chỉ đúng/sai) — không nhầm lẫn 2
        khái niệm này khi tính tổng quát hoá sau này.

      **Test:** `resolve-request-view-scope.test.js` (5 case, mock `can`/`getManagedUserIds`, Mongo thật
      cho `UserInfoModel`), `request-query-filters.test.js` bổ sung `buildUserNameSearchFilter` (3 case,
      chứng minh không crash + tìm đúng), `get-all-requests.http.test.js` (6 case end-to-end: view_all
      loại trừ đơn chính mình, managed-scope đúng, 403, 404 message đúng, search an toàn, request_type
      400 vẫn hoạt động khi wire vào service mới). Tổng 38 test cho toàn module `request` (bao gồm cả
      1.5-1.7), tất cả pass. `npm test` toàn repo: 292 pass / 17 fail — vẫn đúng 4 suite pre-existing,
      không regression mới.

      **Swagger:** cập nhật `GET /requests` — thêm đầy đủ query params (`request_type/status/from/to/
      search/page/limit`), response `400`/`404` mới, mô tả rõ hành vi loại trừ đơn của chính mình ở
      nhánh view_all. Verify lại `require("./src/config/swagger")` load đủ 192 path.
- [x] 1.9 — `getById`: `application/get-request-by-id.service.js` — đọc `RequestModel` (populate
      `user_id` + `reviewed_by`), enrich `approvals` (kèm `reviewer` profile qua
      `resolveReviewerProfileByAccountId`), `reviewed_by_profile`, `pending_reviewer` — y hệt code
      gốc, chỉ đổi cách tổ chức.

      **Xác nhận giả thuyết ở task 1.8 — ĐÚNG, không dùng chung được với `resolveRequestViewScope`:**
      đọc code gốc `getById` xác nhận rule authorization 3 tầng (owner / `canViewAll` / (`canReview`
      AND **trong chuỗi phê duyệt cụ thể của chủ đơn**, qua `getApprovalChain(request.user_id._id)`)
      — khác hẳn `getAll` (scope theo `getManagedUserIds`, toàn bộ cây quản lý, không phải 1 chuỗi cụ
      thể của 1 người). Đúng như đã cảnh báo ở task 1.8: **không ép dùng chung**, viết logic riêng cho
      `getById` — quyết định "chờ bằng chứng thật rồi mới trừu tượng hoá" (Rule of Three) đã đúng.

      **Tối ưu zero-risk (khác 4 bug đã sửa trước — đây KHÔNG phải bug, chỉ tránh tính toán trùng):**
      code gốc gọi `getApprovalChain(request.user_id._id)` **2 lần độc lập** trong cùng 1 request khi
      cả 2 điều kiện cùng đúng (không phải owner/viewAll nhưng canReview — VÀ đơn đang pending) — 1 lần
      để check "có nằm trong chuỗi không", 1 lần nữa để tính `pending_reviewer`. Cùng tham số, cùng
      trạng thái DB trong 1 request → kết quả chắc chắn giống hệt nhau, an toàn để nhớ lại (memoize)
      thay vì gọi lại. Đã cài `getChain()` closure cache trong service, verify bằng test đếm số lần
      gọi mock (`getApprovalChain).toHaveBeenCalledTimes(1)`) — xác nhận đúng chỉ gọi 1 lần dù cả 2
      nhánh cùng cần.

      **Tối ưu zero-risk thứ 2 (phát hiện sau, cùng tinh thần):** `approvals` (N lần gọi
      `resolveReviewerProfileByAccountId`, chạy song song qua `Promise.all`) và `reviewed_by_profile`
      (1 lần gọi riêng) **độc lập với nhau** (không bên nào phụ thuộc kết quả bên kia) nhưng code ban
      đầu chạy **tuần tự 2 pha** (`await Promise.all(approvals...)` xong mới `await
      resolveReviewerProfileByAccountId(reviewed_by...)`). Gộp cả 2 vào chung 1 `Promise.all` ngoài
      cùng — tổng số query không đổi, chỉ chạy đồng thời thay vì nối tiếp, giảm wall-clock time. Verify
      lại 15 test cũ của 1.9 vẫn pass nguyên vẹn (không đổi kết quả, chỉ đổi thời điểm chạy).

      **Phát hiện + đính chính lớn hơn phạm vi 1.9 (xem mục 3, "Đính chính"):** trong lúc viết service
      này, phát hiện `getApprovalChain`/`getManagedUserIds`/`resolveReviewerProfileByAccountId` — cả 3
      hàm ở `helpers/` — thực ra **chỉ được `Request` dùng** (verify bằng `grep` toàn repo, không có
      consumer nào khác), khác với `can()`/`rbac.js` (dùng thật ở 12 route file). Đã thêm quy tắc mới
      vào mục 5 ("Cách làm việc"): mọi lần đụng tới hàm ở `helpers/`, phải `grep` xác nhận ai dùng thật
      trước khi kết luận nó là Domain Service dùng chung hay riêng của 1 module. **Quyết định:** giữ
      nguyên import cũ trong 1.9 (tránh trộn 2 loại thay đổi), tách thành **task riêng ngay sau đây**
      để di chuyển 3 hàm này vào `modules/request/domain/`.

      **Test:** `get-request-by-id.test.js` (11 case: 400 id sai, 404 không tồn tại, owner xem được,
      viewAll xem được, 403 không có gì, 403 canReview nhưng không trong chuỗi, 200 canReview và trong
      chuỗi, pending_reviewer null khi không pending, pending_reviewer đúng người tiếp theo, memoize
      `getApprovalChain` chỉ 1 lần, approvals enrich đúng reviewer profile) +
      `get-request-by-id.http.test.js` (4 case end-to-end qua route thật). Tổng 15 test mới, tất cả
      pass. `npm test` toàn repo: 307 pass / 17 fail — vẫn đúng 4 suite pre-existing, không regression.

      **Swagger:** thêm mới hoàn toàn `GET /requests/{id}` (trước đây chưa có tài liệu gì) — mô tả rõ
      khác biệt với `getAll` (chuỗi duyệt cụ thể, không phải toàn bộ scope quản lý). Gặp lại đúng lỗi
      YAML comma-trong-flow-map như task 1.7 (`{ description: ..., kèm ... }` bị hiểu nhầm thành 2
      key) — sửa bằng block-style như lần trước. Verify `require("./src/config/swagger")` load đủ 193
      path (192 + 1 mới).

- [x] 1.9b — **Task phụ (đã hứa ngay sau 1.9):** di chuyển `getApprovalChain`/`getManagedUserIds`
      (từ `helpers/approvalChain.js`) và `resolveReviewerProfileByAccountId` (tách riêng khỏi
      `helpers/requestUtils.js`, các export khác của file này KHÔNG di chuyển — xem lý do dưới) vào
      `modules/request/domain/approval-chain.js` và `modules/request/domain/resolve-reviewer-profile.js`.

      **Grep lại kỹ hơn trước khi move — không di chuyển nguyên cả file `requestUtils.js`:** áp dụng
      đúng quy tắc mới (mục 5) ở cấp độ **từng hàm export**, không chỉ cấp file. Kết quả:
      - `notify` — dùng cả ở `weeklyReportJob.js` (module khác hẳn) → **giữ nguyên ở `helpers/`**,
        dùng chung thật.
      - `calcTotalDays`/`buildWorkDatesWithStatus` — chỉ `Request` dùng, nhưng qua các
        `*Handler.js` (`leaveHandler.js`...) **chưa migrate** (thuộc phạm vi task 1.11) → **chưa
        move**, để dành khi làm 1.11 (tránh đụng file handler chưa tới lượt).
      - `acquireRequestReviewLock`/`RequestReviewLockError` — chỉ `Request` dùng, nhưng thuộc luồng
        `review` đa duyệt **chưa migrate** (task 1.13) → **chưa move**, để dành khi làm 1.13.
      - `resolveReviewerProfileByAccountId` — chỉ `Request` dùng, VÀ đã có consumer thật ở code mới
        (`get-request-by-id.service.js`) → **move ngay**, chín muồi nhất.

      **Cập nhật import ở mọi nơi:** `RequestController.js` (legacy, vẫn còn sống tới 1.15),
      3 application service (`get-eligible-reviewers`, `resolve-request-view-scope`,
      `get-request-by-id`), và 5 file test (`__tests__/approvalChain.test.js` — test cũ tiền-migration,
      chỉ sửa import path không sửa assertion — cộng 4 file test mới của `request` module có
      `jest.mock(".../helpers/approvalChain")`).

      **Verify kỹ trước khi kết luận xong** (đúng tinh thần "test thật, không đoán"): `node --check` +
      `eslint` sạch trên toàn bộ 12 file đụng tới. Chạy `npm test` toàn repo lần đầu ra thêm 1 fail lạ
      ở `get-request-by-id.http.test.js` ("Parse Error: Expected HTTP/...") — chạy lại riêng file đó
      thì pass 4/4, chạy lại toàn bộ suite lần 2 cũng hết — kết luận đây là resource contention nhất
      thời khi chạy `--runInBand` ~38 suite cùng lúc, không phải regression. Riêng `approvalChain.test.js`
      (file vừa sửa import) fail đúng 5/16 case — **verify bằng `git stash`**: chạy lại đúng code gốc
      (trước khi move) với file test gốc, **fail y hệt 5/16 case** — xác nhận 100% đây là vấn đề
      pre-existing đã biết từ Phase 0 (nghi ngờ liên quan ngày/giờ), không phải do move file gây ra.
      `requestApprovalFlow.test.js` (dùng `RequestController.js` vừa sửa import) fail đúng 3/26 — khớp
      chính xác 3 case pre-existing đã biết. `requestControllerCreate.test.js` pass 100%. `npm test`
      toàn repo (lần chạy sạch): 307 pass / 17 fail — vẫn đúng 4 suite pre-existing, không regression
      nào từ việc move file.

**Backlog kỹ thuật phát hiện sau 1.9b — CHƯA LÀM, ghi lại để không quên:**

- **N+1 round-trip trong `resolveDepartmentHead` (`modules/request/domain/approval-chain.js`):**
  vòng lặp `for (const account of accounts) { if (await can(account, ...)) ... }` gọi `can()` **tuần
  tự, từng account 1** — mỗi account là 1 cache-key Redis riêng (`rbac:perms:${accountId}`), không
  hưởng lợi cache như trường hợp "1 account, 2 permission code khác nhau" (đã verify ở task 1.8).
  **Verify thật:** phòng ban 15 người, người có quyền nằm cuối danh sách → `UserRoleModel.find` bị
  gọi đúng 15 lần tuần tự (31ms trên Mongo local — Mongo thật/phòng ban lớn hơn có thể chậm hơn nhiều).

  **Đã bác 2 hướng sửa:**
  1. Đổi sang aggregation Mongo 1 round-trip — **sai với schema thật**, tự ý viết lại logic
     `can()`/`mergePermissions` (roles nhiều-nhiều qua `UserRoleModel`, permission qua
     `RolePermissionModel`, override ALLOW/DENY qua `UserPermissionModel`, admin bypass) thành
     pipeline riêng → nhân bản business logic phân quyền ở 2 nơi, rủi ro lệch nhau về sau nguy hiểm
     hơn cả vấn đề hiệu năng ban đầu (sai âm thầm, không phải chậm).
  2. Đổi `for...of` tuần tự → `Promise.all` song song — chỉ đổi CÁCH GỌI, không giảm số round-trip
     (vẫn N), và làm mất lợi ích "dừng sớm" ở case phổ biến (trưởng phòng thường ở đầu danh sách).

  **Hướng đúng (theo góp ý người dùng — tách đúng 2 concern):** `can()` không sai, chỉ sai
  **granularity** (1 account/lần) cho nhu cầu này. `rbac.js` (chủ sở hữu duy nhất logic phân quyền)
  cần thêm 1 hàm MỚI dạng batch — vd `getAccountIdsWithPermission(accounts, permissionCode)` — dùng
  lại đúng `mergePermissions()` hiện có, chỉ đổi cách LẤY DỮ LIỆU ĐẦU VÀO từ "N query, 1 account/lần"
  sang "~3 query cố định, tất cả account cùng lúc" (`UserRoleModel.find({user: {$in: ids}}})`,
  `RolePermissionModel.find({role: {$in: allRoleIds}}})`, `UserPermissionModel.find({user: {$in: ids}}})`
  rồi group lại per-account). `approvalChain.js` gọi hàm batch mới này thay vì loop gọi `can()`.

  **⚠️ Lưu ý quan trọng khi triển khai (người dùng nhắc trực tiếp):** `AccountModel.role` hiện là
  string enum `admin|user|manager`, dùng để short-circuit trong `can()`
  (`if (account.role === ROLE.ADMIN) return true`). **Người dùng dự định BỎ field này trong tương
  lai** (chuyển hẳn sang RBAC chi tiết qua `UserRoleModel`/`RolePermissionModel`, không còn khái niệm
  "admin" cấp field). Hàm batch mới **phải xử lý được cả 2 kịch bản**: (a) hiện tại — còn field
  `role`, admin bypass mọi permission; (b) tương lai — field này có thể không còn, phải suy ra quyền
  hoàn toàn qua role/permission chi tiết. Không được viết cứng logic chỉ đúng cho kịch bản (a).

  **Chưa làm — tách thành task riêng, ngoài phạm vi migrate `request` hiện tại** (đụng tới `rbac.js`
  dùng chung ở 12+ route file khác, cần review/test riêng biệt do phạm vi ảnh hưởng rộng).

- **7 file `helpers/*Handler.js` (task 1.11, người dùng chủ động nhắc "check lại logic helper trước
  khi đưa vào nơi phù hợp"):** verify bằng grep toàn repo trước khi kết luận (đúng quy tắc mục 5):
  - `remoteHandler`/`businessTripHandler`/`clientVisitHandler`/`explanationHandler` — chỉ `Request`
    dùng, sạch, sẵn sàng move nguyên vẹn. `awayDayHandler.js` (factory `createOnApprove` dùng chung
    bởi 3 handler trên) — cũng chỉ Request dùng, nhưng tự nó phụ thuộc `resolveLeaveConflictOnAttendance`
    của `leaveHandler.js` — move cùng đợt với `leaveHandler` sau khi tách.
  - `leaveHandler.js` — **file lai**: phần lớn (`validate`/`validateAsync`/`onCreate`/`onApprove`/
    `onReject`) chỉ Request dùng, nhưng `resolveLeaveConflictOnAttendance` dùng chung thật với
    `AttendanceController.js`/`helpers/attendanceHelper.js`/`helpers/awayDayHandler.js` — phải tách
    hàm này ra riêng trước, không move nguyên cả file.
  - **`lateEarlyHandler`/`forgotCheckinHandler` — KHÔNG move, để lại `helpers/` tới Phase 8:** 2 file
    này phụ thuộc SÂU vào `attendanceHelper.js`/`attendancePenalty.js`/`jobs/finalizeWorkDay.js` —
    những file này cũng được `AttendanceController.js` và cron job (`jobs/index.js`) dùng trực tiếp.
    Đây là giao điểm thật giữa 2 domain, không phải "được Request gọi" đơn thuần — di chuyển 2 handler
    này bây giờ có nguy cơ phải đụng lại khi Phase 8 (`attendance`) tới. Đã bàn 5 hướng kiến trúc cho
    ranh giới Request↔Attendance (Shared Kernel / 1 chiều phụ thuộc / gộp module / Anti-Corruption
    Layer / trì hoãn) — **chọn trì hoãn quyết định cấu trúc cuối cùng tới Phase 8**, nhưng đã chốt
    hướng kỹ thuật cho 2 nhu cầu cụ thể ("trừ ngày phép", "chặn trùng ngày"): ưu tiên ép ở tầng DB/mô
    hình hoá `LeaveBalance` thành aggregate riêng khi migrate chính thức, **không** dùng Saga hay chấp
    nhận eventual-consistency cho 2 nhu cầu này (2 domain cùng 1 MongoDB, transaction ACID đã đủ dùng
    và đã chứng minh chạy đúng ở task 1.10).

    **Phát hiện phụ trong lúc bàn — race condition có thật, CÓ SẴN TỪ CODE GỐC, chưa sửa:** cơ chế
    "MongoDB tự phát hiện write conflict" (verify ở task 1.10) chỉ bảo vệ khi 2 transaction cùng ghi
    **1 document đã tồn tại**. Với việc TẠO MỚI 2 document khác nhau (2 đơn leave/remote/business_trip/
    client_visit/forgot_checkin chồng lấn ngày, insert gần như đồng thời), MongoDB không coi là conflict
    — `validateAsync()`'s check chồng lấn chỉ là query trong transaction, không có gì ở tầng DB chặn
    cứng (unique index không giải quyết được vì đây là range-overlap, không phải trùng khoá). Cùng loại
    phát hiện như các bug nghiệp vụ đã ghi ở task 1.1 — **không tự sửa, cần task riêng có xác nhận**
    (hướng khả dĩ: lock theo `(user_id, request_type)` trước check+insert, theo pattern
    `acquireRequestReviewLock`/`acquireUserLeaveLock` đã có sẵn).

  - **Quyết định thời điểm move — đẩy xuống SAU task 1.15 (không phải ngay sau 1.11 như dự định ban
    đầu):** lý do — `RequestController.js` (bị xoá ở 1.15) hiện import 7 handler này TRỰC TIẾP; move
    ngay bây giờ phải sửa import ở file sắp xoá, tốn công thừa. Đợi tới sau 1.15: mọi code mới
    (1.10-1.13) đều gọi qua `request-type-handlers.js`, không import handler trực tiếp — lúc đó move
    chỉ cần sửa `request-type-handlers.js` + vài test file đang import trực tiếp để spy
    (`leaveHandler` ở `create-request.test.js`/`cancel-request.test.js`).
  - **Không đẩy Phase 8 (`attendance`) lên sớm hơn trong roadmap** dù phát hiện ràng buộc sâu với
    Request — đã cân nhắc, quyết định hoàn thành nốt Phase 1 (1.12-1.16) trước, bàn lại thứ tự Phase
    2-8 như 1 quyết định riêng sau khi Phase 1 xong hẳn (không phản ứng vội theo 1 phát hiện cục bộ).

### Action ghi (rủi ro cao hơn — characterization test trước nếu cần, mỗi task verify kỹ)

- [x] 1.10 — `cancel`: action GHI đầu tiên (khác hẳn 1.6-1.9, tất cả đều đọc). Load entity qua
      `RequestRepository.findOneById` (không phải raw Mongoose document như code gốc), check tồn
      tại → check hồ sơ nhân viên → check chủ sở hữu → `entity.cancel()` (tự check `pending` qua
      invariant có sẵn từ task 1.1) → gọi `handler.onReject` nếu loại đơn có (side-effect, vd hoàn
      ngày phép) → `requestRepository.updateById`.

      **Building block mới, dùng chung cho mọi action ghi sau này:**
      - `domain/request-type-handlers.js` — registry `request_type -> handler module`, tránh định
        nghĩa lại object này ở cả `cancel` (1.10) và `create` (1.11).
      - `core/db/run-in-transaction.js` — bọc `startSession/startTransaction/runChild/commit`,
        **map lỗi transient transaction (MongoDB gắn nhãn `errorLabels: ["TransientTransactionError"]`
        — cách chính thức MongoDB khuyến nghị để nhận diện, không hardcode `error.code`) thành
        `ConflictException` (409)** thay vì để lỗi thô `MongoServerError` lộ ra ngoài. Dùng lại cho
        1.11/1.12/1.13 (đã xác nhận trước khi viết — không phải đoán, vì biết chắc các task sau
        cũng cần transaction y hệt).

      **1 bug thật phát hiện + sửa TRƯỚC khi test (không đợi test fail):** `handler.onReject(request,
      session, isCancel)` — cả `leaveHandler`/`forgotCheckinHandler` đọc `request._id` (quy ước
      Mongoose document), nhưng `entity.getProps()` chỉ có `id`, không có `_id` — nếu truyền thẳng,
      `adjustLeaveBalance({refId: request._id})` nhận `undefined`, sai dữ liệu tham chiếu âm thầm.
      Đã map `{ ...props, _id: props.id }` khi gọi handler.

      **Message 403 tách theo yêu cầu người dùng (khác code gốc — code gốc gộp chung, xem thảo
      luận):** code gốc `if (!userInfo || !request.user_id.equals(userInfo._id))` → 1 message
      403 duy nhất cho 2 điều kiện khác nhau. Đã tách: thiếu hồ sơ nhân viên → 404 "Không tìm thấy
      thông tin nhân viên" (nhất quán với 1.6-1.9), có hồ sơ nhưng không phải chủ đơn → 403 "Bạn
      không phải chủ đơn này, không thể hủy".

      **Race condition — đã verify thật bằng transaction thật (`MongoMemoryReplSet`), không suy
      luận:** 2 lần gọi `cancelRequest()` đồng thời cho CÙNG 1 đơn → verify bằng test thật: MongoDB
      tự phát hiện write conflict ở tầng transaction (1 request FULFILLED, 1 REJECTED) — dữ liệu
      `Request` document KHÔNG bị hỏng. Tưởng `handler.onReject` (gọi 2 lần ở tầng JS function) có
      thể gây double-refund ngày phép — verify bằng cách đếm dòng thật trong `LeaveBalanceModel`:
      **chỉ 1 dòng, không phải 2** — vì `adjustLeaveBalance` dùng đúng `session` truyền vào, ghi của
      transaction bị abort tự động rollback theo cả transaction. **Không phải bug**, nhưng lỗi thô
      MongoDB (`Write conflict during plan execution...`, `codeName: "WriteConflict"`,
      `errorLabels: ["TransientTransactionError"]`) lộ ra client là vấn đề thật — đã sửa qua
      `run-in-transaction.js` ở trên. Verify lại sau khi sửa: request thua cuộc nhận đúng
      `ConflictException` (409, message rõ ràng), không còn lỗi thô.

      **Test:** `cancel-request.test.js` (8 case: 400 id sai, 404 không tồn tại, 404 thiếu hồ sơ,
      403 không phải chủ đơn, 409 sai trạng thái, 200 thành công kèm verify `handler.onReject` nhận
      đúng `_id`/hoàn đúng số ngày phép vào `LeaveBalanceModel` thật, 200 loại đơn không có
      `onReject` vẫn hoạt động, race concurrency 1 thành công/1 conflict sạch). Tất cả 8/8 pass.
      `npm test` toàn repo: 315 pass / 17 fail — vẫn đúng 4 suite pre-existing, không regression.

      **Swagger:** cập nhật `PATCH /requests/cancel/{id}` — mô tả rõ side-effect khi hủy, tách đúng
      403/404, thêm `409` cho cả 2 lý do (sai trạng thái + race). Verify load đủ 193 path.
- [x] 1.11 — `create`: `application/create-request.service.js` — action ghi phức tạp nhất. Luồng:
      check `request_type` (tái dùng `VALID_TYPES` từ `request-query-filters.js`, không định nghĩa
      lại) → tìm `userInfo` → `handler.validate(body, userInfo)` **ngoài** transaction (đúng y hệt
      code gốc) → trong `runInTransaction` (task 1.10): `handler.validateAsync()` →
      `RequestEntity.create()` (Entity, không phải raw document) → `requestRepository.insert()` →
      `handler.onCreate()` nếu có (map `_id` như đã làm ở cancel) → sau khi commit, fire-and-forget
      `notify()` người duyệt gần nhất qua `getApprovalChain` (y hệt code gốc, lỗi ở đây không ảnh
      hưởng response đã trả về).

      **Building block mới — `toHandlerException()`:** 7 handler (`helpers/*Handler.js`, chưa migrate
      — xem backlog dưới) trả lỗi dạng `{status, message}` thô, không phải `ExceptionBase`. Đã grep
      toàn bộ 7 handler xác nhận **chỉ 3 status code thật sự dùng** (400/403/409) trước khi viết map
      — không đoán. Map đúng 3 case + fallback `ArgumentInvalidException` (400) an toàn cho case lạ.
      Đã đọc kỹ `leaveHandler.js` (400+ dòng, phức tạp nhất) trước khi thiết kế — xác nhận
      `onApprove`/`onReject` (dùng ở review, 1.12/1.13) **không** trả lỗi kiểu này, chỉ side-effect
      thuần — nên `toHandlerException` chỉ cần cho `create`, không phải building block dùng chung
      thêm cho review.

      **Phát hiện thêm (người dùng chủ động yêu cầu kiểm tra) — xem "Backlog kỹ thuật" bên dưới:**
      grep toàn bộ 7 file `helpers/*Handler.js` xác nhận 6/7 file chỉ `Request` dùng (sẵn sàng move),
      riêng `leaveHandler.js` là **file lai** (phần lớn Request-only, nhưng
      `resolveLeaveConflictOnAttendance` dùng chung thật với `AttendanceController.js`) — cần tách
      trước khi move. **Quyết định: giữ nguyên vị trí lúc làm 1.11, tách thành task riêng ngay sau**
      (theo đúng mẫu 1.9b) — đã ghi chi tiết vào backlog.

      **Test:** `create-request.test.js` (9 case: 400 loại đơn sai, 404 thiếu hồ sơ, 400 lỗi validate
      sync, 409 lỗi validateAsync — verify map đúng exception, 201 thành công remote không có
      `onCreate` kèm verify `notify` gọi đúng người/đúng params sau commit, 201 khi chain rỗng không
      throw không gọi notify, 201 nghỉ phép unpaid không side-effect, 201 nghỉ phép paid verify
      `onCreate` trừ đúng số ngày phép vào `LeaveBalanceModel` thật + `_id` map đúng, rollback khi
      `onCreate` lỗi — verify KHÔNG lưu document). Tự phát hiện 1 lỗi trong chính test (không phải
      bug code): dùng ngày tương đối ban đầu có thể rơi vào Thứ 7 — nghiệp vụ công ty coi Thứ 7 là
      nửa ngày công (`calcTotalDays`), làm `total_days` ra 0.5 không xác định tuỳ ngày chạy test thật
      — sửa bằng helper `weekdayFromNow()` luôn nhảy qua Thứ 7/Chủ nhật. Tất cả 9/9 pass. `npm test`
      toàn repo: 324 pass / 17 fail — vẫn đúng 4 suite pre-existing, không regression.

      **Swagger:** cập nhật `POST /requests` — thêm enum `request_type`, tách rõ `400`/`403`/`404`/
      `409` (trước đây chỉ có `400` chung chung + `404`). Verify load đủ 193 path (không tăng vì là
      endpoint đã có, chỉ cập nhật docs).
- [x] 1.12 — `review` nhánh **1 người duyệt**: `application/review-request.service.js`.

      **Nhờ entity đã đúng từ task 1.1, application service gọn hơn nhiều so với code gốc:**
      `entity.approve()`/`entity.reject()` tự check self-review (`CannotSelfReviewError` 403), trạng
      thái pending (`InvalidStatusTransitionError` 409), đã duyệt rồi (`AlreadyReviewedError` 409) —
      service chỉ còn lo phần entity không biết: authorization (`canReviewAll` hoặc trong
      `approvalChain`) và notify. `entity.approve()` cũng đã tự xử lý đúng CẢ nhánh đơn/đa duyệt (thiết
      kế từ task 1.1) — nên dù đây là task "nhánh 1 người duyệt", code đã chạy đúng cho case tuần tự
      (không đồng thời) của cả 2 nhánh; `isFinal` xác định bằng `entity.status !== "pending"` sau khi
      gọi approve/reject.

      **Phạm vi cố ý giới hạn (ghi rõ trong code) — dành cho 1.13:** chưa có Redis lock, chưa có check
      "trưởng bộ phận phải duyệt trước" cho `forgot_checkin`/`late_early` đa duyệt. **Route
      `/review/:id` CHƯA cutover** — cố tình giữ nguyên `RequestController.review` cũ, vì thiếu rule
      "trưởng bộ phận trước" sẽ là regression thật cho 2 loại đơn đó nếu route đổi ngay bây giờ. Cutover
      dời tới khi 1.13 xong hoàn chỉnh.

      **Message nhất quán:** đổi "Không tìm thấy thông tin quản lý" (gốc) → "Không tìm thấy thông tin
      nhân viên", theo đúng tiền lệ 1.8/1.10.

      **1 khác biệt nhỏ so với gốc, chấp nhận được:** code gốc check tự-duyệt TRƯỚC check trong-chuỗi;
      ở đây ngược lại (trong-chuỗi trước, vì tự-duyệt nằm trong `entity.approve()` gọi sau) — chỉ lộ
      khác biệt (về MESSAGE, không phải kết quả chặn) nếu 1 người không có `canReviewAll` cố tự duyệt
      đơn mình. Không sửa vì thêm check trùng lặp chỉ để khớp message ở edge-case hiếm không đáng.

      **Verify thật bằng transaction thật (không suy luận) — theo đúng câu hỏi của người dùng về lost
      update:** 2 reviewer khác nhau approve đồng thời cùng 1 đơn đa duyệt → MongoDB tự phát hiện write
      conflict (giống hệt cơ chế đã verify ở task 1.10) — 1 request FULFILLED (approvals=1), 1
      REJECTED sạch với `ConflictException` (409, đã map sẵn từ `run-in-transaction.js`) — **không có
      lost update**, dù `updateById` là "load toàn bộ, tính trong app, ghi đè toàn bộ" chứ không dùng
      optimistic-lock version field tường minh. Lý do: MongoDB multi-document transaction tự cung cấp
      đúng optimistic concurrency control cần thiết ở tầng storage engine — không cần version field.
      **Điều chỉnh hiểu biết về vai trò Redis lock (1.13):** không phải để chống mất dữ liệu (đã có
      transaction lo) — mà để tránh trải nghiệm xấu (reviewer thứ 2 hiện phải tự retry khi gặp 409; có
      lock sẽ tự chờ rồi xử lý êm).

      **Đề xuất A đã triển khai (theo yêu cầu người dùng) — vá lỗ hổng minh bạch cho case "reject đè
      lên approval đã có" (phát hiện từ task 1.1, giữ nguyên veto-1-người, không đổi state machine):**
      - `RequestRejectedDomainEvent` — thêm field `overriddenApprovals` (snapshot `approvals` trước khi
        reject), để không mất dấu vết approval đã có khi bị override.
      - `RequestEntity.reject()` — snapshot `approvals` trước khi mutate, truyền vào event.
      - `notifyAfterReview()` — khi reject 1 đơn đã có ≥1 approval, đổi nội dung thông báo (cho cả
        người nhận đơn lẫn broadcast) thành "đã được duyệt 1 phần trước đó, nhưng bị... từ chối" thay
        vì chỉ nhắc người từ chối, không còn im lặng bỏ qua approval đã ghi nhận.
      - Test mới `request-entity-reject.test.js` (3 case, riêng cho entity — chưa từng có file test
        persist cho `RequestEntity` từ task 1.1, chỉ có smoke test tạm) khoá đúng hành vi: veto-1-người
        vẫn hoạt động y hệt gốc, nhưng event giờ mang `overriddenApprovals` đúng.

      **Test:** `review-request.test.js` (15 case: 400 id/action sai, 404 thiếu hồ sơ/không tồn tại,
      403 không có quyền/tự duyệt, 409 sai trạng thái, 200 approve/reject 1-người-duyệt, đa duyệt lần
      1 không finalize không gọi `onApprove`, đa duyệt lần 2 finalize gọi đúng `onApprove` với `_id`
      map đúng, 409 duyệt 2 lần cùng 1 người, reject đè lên approval đã có vẫn cho phép + gọi đúng
      `onReject`, notify đúng nội dung 1/2 và nội dung khi reject có approval trước đó) + 3 case entity.
      Tổng 18 test mới, tất cả pass. `npm test` toàn repo: 342 pass / 17 fail — vẫn đúng 4 suite
      pre-existing, không regression.

      **Swagger:** chưa cập nhật (route chưa cutover, hành vi thật vẫn là code gốc) — dời tới khi 1.13
      xong.
- [x] 1.13 — `review` nhánh **đa duyệt** (mở rộng từ 1.12): thêm Redis lock (`acquireRequestReviewLock`,
      giữ nguyên hàm gốc trong `helpers/requestUtils.js`, không viết lại) trước transaction khi
      `action === "approve"` và `entity.needsMultiApproval()` — check/push/finalize approvals đã có sẵn
      từ `RequestEntity.approve()` (task 1.1), service chỉ cần acquire/release lock quanh nó. Thêm rule
      "trưởng bộ phận phải duyệt trước" cho `forgot_checkin`/`late_early` đa duyệt (`LEVEL1_FIRST_TYPES`,
      chỉ áp dụng khi `approvals.length === 0 && !canReviewAll`, y hệt điều kiện code gốc).

      **Khác biệt nhỏ so với gốc, chấp nhận được:** code gốc dùng 1 query projection tối giản
      (`{request_type,total_days,occurrence}`) để quyết định có cần lock hay không trước khi mở
      transaction; ở đây dùng luôn `requestRepository.findOneById()` (trả full Entity) cho cả pre-check
      lẫn fetch thật trong transaction — không có method load-partial-fields trong `RequestRepository`
      hiện tại, và chi phí thêm không đáng kể so với round-trip DB đã có sẵn. Không thêm method mới chỉ
      để tối ưu vi mô này.

      `RequestReviewLockError` (không phải `ExceptionBase`, không tự map qua `handle-exception.js`) —
      bọc lại thành `ConflictException` (409) ngay tại nơi gọi (`acquireLockIfNeeded`), để lỗi hết hạn
      chờ lock cũng trả JSON `{message}` nhất quán thay vì rơi vào nhánh 500 mặc định.

      **Verify thật (không suy luận):** test "2 reviewer approve đồng thời" dùng `Promise.all` thật trên
      cùng 1 đơn đa duyệt — với lock, cả 2 lời gọi đều **fulfilled** (không có bên nào nhận
      `ConflictException` như ở 1.12 khi chưa có lock), đúng 1 lần finalize, approvals đủ 2 — xác nhận
      lock thực sự loại bỏ tình huống phải retry phía client (vai trò UX, không phải data-integrity, đã
      ghi ở note 1.12).

      **Route cutover:** `/review/:id` giờ trỏ `requestHttpController.review` (module mới); xoá import
      `RequestController` khỏi `request.routes.js`. `RequestController.js` cũ CHƯA xoá file (dời task
      1.15) — 3 file test gọi thẳng `RequestController.review()` không qua route
      (`requestApprovalFlow.test.js`, `forgotCheckinApprove.test.js`) nên không bị ảnh hưởng bởi cutover
      này, tiếp tục nằm trong 17 fail pre-existing đã biết từ trước, xác nhận lại bằng cách so khớp tên
      test fail trước/sau cutover — không đổi.

      **Swagger** (`src/docs/request.yaml`, endpoint `/requests/review/{id}`): thêm mô tả hành vi đa
      duyệt (lượt đầu không finalize), rule trưởng bộ phận duyệt trước (403), lock timeout (409).

      **Test:** `review-request.test.js` thêm 5 case mới (tổng 20): 1 case đa duyệt-đồng-thời qua lock,
      4 case rule trưởng-bộ-phận (chặn khi không phải chain[0], cho phép khi là chain[0], bỏ qua rule khi
      approvals đã có ≥1, bỏ qua rule khi `canReviewAll`). `npm test` toàn repo: 347 pass / 17 fail —
      đúng 4 suite pre-existing, không regression (tăng đúng 5 test mới).

### Hoàn thiện

- [x] 1.14 — Đăng ký event handler cho domain event (thông báo — logic y hệt hiện tại, chỉ đổi chỗ gọi
      từ inline trong service sang subscribe theo event).

      **Hạ tầng mới:** thêm dependency `eventemitter2` (bắt buộc — `aggregate-root.base.js` từ Phase 0
      đã viết `publishEvents()` dùng `eventBus.emitAsync()`, API riêng của thư viện này, native
      `EventEmitter` không có). Kiểm tra trước khi thêm: 67.8M lượt tải/tháng, 0 dependency, ổn định lâu
      năm — không phải gói bị bỏ rơi dù ít release, đạt tiêu chí "còn maintain" ở nguyên tắc 2b.
      `src/core/events/event-bus.js` — 1 singleton `EventEmitter2` dùng chung toàn app.

      **`src/modules/request/application/request-notification.handlers.js`** — 4 handler
      (`onRequestCreated`, `onRequestPartiallyApproved`, `onRequestApproved`, `onRequestRejected`),
      logic notify giữ nguyên y hệt bản inline cũ (nội dung, người nhận, dedupe), chỉ khác: handler nhận
      `event` (chỉ có id + primitive field) thay vì object đã load sẵn, nên tự query lại `full_name`/
      `id_account` từ `event.userId`/`event.reviewerId` qua `UserInfoModel` — đúng tinh thần "domain
      event mang dữ liệu tối thiểu, handler tự tra cứu", không phình event ra thành DTO đầy đủ.
      `RequestCancelledDomainEvent` chưa có handler nào subscribe (đúng hành vi gốc — cancel không từng
      gửi thông báo), chỉ publish để không bỏ phí event đã buffer, sẵn sàng cho handler sau này nếu cần.

      **3 service (`create-request`, `review-request`, `cancel-request`) đổi thành:** gọi
      `entity.publishEvents(eventBus).catch(() => {})` sau khi transaction commit, thay cho khối
      `notify(...).catch(() => {})` inline. `review-request.service.js` giảm ~90 dòng (xoá hẳn hàm
      `notifyAfterReview` — logic rẽ nhánh `isFinal`/`action` giờ không cần nữa vì đã nằm sẵn trong việc
      `entity.approve()`/`.reject()` chọn đúng loại event để add).

      **Quyết định wiring (đã bàn kỹ, không phải "textbook" Hexagonal thuần tuý):** mỗi service tự
      `require("./request-notification.handlers")` (side-effect, không destructure gì) thay vì chỉ wire
      1 lần ở composition root (vd `request.routes.js`). Lý do: test hiện tại `require` thẳng service,
      không qua route — nếu chỉ wire ở routes, listener sẽ chưa đăng ký khi test gọi `publishEvents`,
      notify sẽ im lặng không chạy. Node cache module theo path nên `require` lặp lại nhiều service vẫn
      chỉ chạy đúng 1 lần, không đăng ký trùng/không notify lặp.

      **Test:** không thêm file test riêng cho `request-notification.handlers.js` — toàn bộ hành vi
      notify (nội dung, người nhận, dedupe, message khi reject đè lên approval trước đó) đã được
      `create-request.test.js`/`review-request.test.js` assert sẵn qua `notify.mock.calls`, và các test
      đó **giữ nguyên xanh sau khi refactor** — chính là bài test hồi quy cho việc chuyển sang event-
      driven, viết thêm unit test riêng chỉ lặp lại cùng 1 hành vi. `npm test` toàn repo: 347 pass / 17
      fail — không đổi so với trước 1.14, xác nhận refactor không đổi hành vi quan sát được.
- [x] 1.15 — Xoá `RequestController.js` cũ + code chết liên quan trong `requestUtils.js`; xác nhận 3
      file test cũ (`approvalChain.test.js`, `requestApprovalFlow.test.js`,
      `requestControllerCreate.test.js`) pass không sửa.

      **Đổi kế hoạch so với dự kiến ban đầu (đã hỏi và được xác nhận):** 2/3 file
      (`requestControllerCreate.test.js`, `requestApprovalFlow.test.js`) gọi THẲNG
      `RequestController.create()`/`.review()`/`.getAll()`, không qua HTTP route — xoá controller sẽ
      làm 2 file này vỡ hoàn toàn, không thể "pass không sửa" như dự kiến. Quan trọng hơn:
      `requestControllerCreate.test.js` có nhiều test verify sâu side-effect WorkSheet/Attendance khi
      duyệt đơn (business_trip/leave/remote ghi đúng check_in/check_out/work_unit, dọn sạch dữ liệu cũ
      khi đè lên nhau...) — verify bằng grep xác nhận KHÔNG có file test nào khác cover phần này (test
      mới ở Phase 1 luôn mock hẳn `handler.onApprove`/`onCreate`). Quyết định: **port cả 2 file sang gọi
      service mới**, giữ nguyên mọi assertion, thay vì xoá/giản lược — không đánh đổi coverage.

      **Cách port (không cần sửa từng assertion):** cả 2 file đổi từ gọi `RequestController.create/
      review/getAll` sang gọi qua 1 helper `callController(action, req, res)` tái dùng đúng
      `asyncHandler` + `errorHandlerMiddleware` + `requestHttpController.*` thật — mô phỏng chính xác
      cách Express thật xử lý (bắt reject → format response), nên toàn bộ assertion trên `res.status`/
      `res.json` giữ nguyên không đổi 1 dòng nào ngoài lệnh gọi.

      **Bug thật phát hiện khi port (do migration ở task 1.11 gây ra, không phải pre-existing) — verify
      bằng cách gọi thẳng `createRequest()` qua script, thấy `TypeError: request.save is not a
      function`:** `lateEarlyHandler.onCreate`/`forgotCheckinHandler.onCreate` tính `occurrence` (đơn
      thứ mấy trong kỳ, dùng cho ngưỡng đa duyệt task 1.13) rồi tự `request.save()` — nhưng
      `create-request.service.js` truyền vào `{...entity.getProps(), _id}` (plain object), không phải
      Mongoose document thật → tạo đơn `late_early`/`forgot_checkin` lỗi 500 **100% các lần**. Không bị
      bắt bởi test cũ vì `create-request.test.js` (Phase 1) chưa từng test 2 loại này với handler thật.

      **Đã bàn kỹ hướng sửa (2 phương án), chọn phương án gọn nhất:** thay vì giữ nguyên thời điểm tính
      occurrence (sau khi insert, cần patch ngược — cách này cần thêm method
      `applyTypeSpecificPatch`/`assignOccurrence` trên entity + 1 lần ghi DB nữa), chuyển hẳn việc tính
      occurrence sang **trước khi tạo đơn**, trong `validateAsync` (hook async có sẵn, chạy trước
      `RequestEntity.create()`). Nhờ vậy KHÔNG cần filter loại trừ chính đơn đang tạo (`_id: {$ne:
      ...}` như bản gốc) vì đơn chưa tồn tại lúc tính — đơn giản hơn, chỉ 1 lần ghi DB, không cần thêm
      method mới trên entity, không đụng `RequestRepository`.
      - `validateAsync` đổi contract: `null` (không có gì thêm) | `{status, message}` (lỗi, như cũ) |
        `{...field}` (field bổ sung merge vào entity lúc tạo, vd `{occurrence}`) — chỉ 2 handler
        (`late_early`, `forgot_checkin`) dùng nhánh thứ 3, 5 handler còn lại không đổi gì (vẫn trả
        `null`/lỗi như cũ).
      - `lateEarlyHandler.onCreate` xoá hẳn (toàn bộ nội dung chỉ là tính+lưu occurrence, giờ dời sang
        `validateAsync`, không còn việc gì để làm ở `onCreate`).
      - `forgotCheckinHandler.onCreate` chỉ còn giữ side-effect `WorkDayStatusModel.updateMany` (không
        cần `.save()`, hoạt động bình thường với plain object).
      - Verify: `computeForgotOccurrence` chỉ đếm đơn `status: "approved"` — đơn mới tạo luôn `pending`
        nên tính trước/sau insert cho kết quả giống hệt nhau, không rủi ro sai lệch khi đổi thời điểm.
      - Audit thêm (theo yêu cầu người dùng): grep `.save(` trên toàn bộ 8 handler — xác nhận CHỈ 2 chỗ
        vừa sửa, không có handler nào ẩn `.save()` trong `onApprove`/`onReject`, không cần sửa thêm.
      - Verify thật bằng script gọi `createRequest()` trực tiếp (không suy luận): cả `late_early` và
        `forgot_checkin` tạo thành công, `occurrence` đúng cả ở entity trả về lẫn document trong DB.

      **Phát hiện thêm, KHÔNG sửa (pre-existing business-logic gap, ngoài phạm vi task này):** 3 test
      trong `requestApprovalFlow.test.js` (quản lý cấp trên — không phải cấp gần nhất — vẫn duyệt được;
      2 người khác nhau duyệt đơn đa duyệt; race 2 người duyệt đồng thời) fail vì `getApprovalChain`
      (`resolveDepartmentHead`/`resolveIndirectManagerOrAdmin`) chưa từng có logic "đi lên phòng ban cha
      (division)" để tìm reviewer — chỉ tìm trong đúng phòng ban của nhân viên hoặc field `manager` của
      chính phòng ban đó. Verify bằng `git show HEAD:src/helpers/approvalChain.js | diff -
      domain/approval-chain.js` — logic giống hệt 100% bản đã commit trước khi migration bắt đầu (chỉ
      khác import path do di dời ở 1.9b) → xác nhận đây là gap có sẵn từ trước, không phải do migration,
      cần bàn riêng với người dùng nếu muốn sửa (ảnh hưởng logic phân quyền duyệt đơn).

      **Dọn code chết trong `requestUtils.js`:** xoá `calcWorkUnit` (grep xác nhận 0 nơi sử dụng, kể cả
      trước khi `RequestController.js` bị xoá).

      **Test:** `requestControllerCreate.test.js` (10 test, port nguyên vẹn + fix thêm 1 lỗi teardown
      nhỏ — `afterAll` disconnect DB trước khi fire-and-forget notify của lần gọi cuối kịp xong, thêm
      chờ 50ms), `requestApprovalFlow.test.js` (16 test, port nguyên vẹn, 3 fail như đã giải thích ở
      trên). `npm test` toàn repo: 347 pass / 17 fail — **giữ nguyên y hệt** trước khi làm task này (bug
      500 đã ẩn sau lớp mock ở Phase 1 giờ được fix, không đổi tổng số fail vì 2 file test này vốn đã
      không exercise 2 loại đơn đó qua handler thật cho tới khi port xong).
- [x] 1.16 — Cập nhật `CLAUDE.md` — thêm mục pattern DDD/Hexagonal, trỏ `request` làm ví dụ tham chiếu.

      Cập nhật "Cấu trúc thư mục" (thêm `core/`, `modules/`, đánh dấu `controllers/` là pattern cũ chưa
      migrate) + thêm mục mới "## DDD + Hexagonal Architecture (module mới)": cấu trúc 1 module chuẩn
      (domain/infrastructure/application/interface), 5 quy ước đã chốt (CQRS-lite đọc bypass domain,
      `runInTransaction`, domain event qua `eventBus` + quy ước mỗi service tự `require()` file handler,
      exception ném thẳng qua `core/exceptions/*` + `asyncHandler`/`errorHandlerMiddleware`, request-type
      handler pattern riêng module `request` chưa di chuyển vào domain), và trạng thái migration hiện
      tại (chỉ `request` đã xong). Trỏ `docs/DDD-HEXAGONAL-MIGRATION-PLAN.md` cho chi tiết đầy đủ.

**Definition of done:** test cũ + mới pass, `RequestController.js` cũ không còn được require ở đâu,
`CLAUDE.md` có ví dụ tham chiếu.

## 8. Phase 1.5 — Migrate sang TypeScript

Đặt ngay sau Phase 1 (trước khi mở rộng sang các module khác) vì lúc đó đã có `request` làm module tham
chiếu đầy đủ (domain/infrastructure/application/interface) — dùng chính module này để pilot TS trước
khi áp cho các module tiếp theo, tránh vừa học TS vừa migrate module mới cùng lúc.

**Đã xác nhận qua log Dokploy/Nixpacks thật (không phải suy đoán):**
- Không cần đổi gì trong cấu hình Dokploy. Nixpacks tự chạy `npm run build` (nếu `package.json` có
  script `"build"`) sau `npm ci`, trước khi chạy `npm run start` — cơ chế có sẵn cho đúng case này.
- Việc cần làm chỉ nằm trong repo:
  1. Thêm `typescript` + `@types/*` cần thiết vào `devDependencies`.
  2. Thêm script `"build": "tsc"`.
  3. Đổi `"start": "node index.js"` → `"start": "node dist/index.js"` (theo `outDir` thật sự chọn).
  4. `tsconfig.json`: `outDir`, `rootDir`, target/module CommonJS (giữ nguyên hành vi runtime, chỉ thêm
     type-check + compile step).
- `npm ci` hiện tại cài cả `devDependencies` (không có `.npmrc`/config nào set `production=true` chặn
  điều này) — xác nhận bằng cách đọc trực tiếp repo, không phải đoán từ log.

**Lưu ý riêng, KHÔNG thuộc phạm vi phase này, chỉ ghi nhận:**
- Production hiện chạy Node 18.20.5, trong khi nhiều dependency (`mongodb`, `bson`,
  `mongodb-memory-server`, `swagger-jsdoc`, `glob`, `lru-cache`...) khai báo `engines` yêu cầu Node ≥20
  (warning có sẵn, không do TS gây ra). Nên cân nhắc nâng Node version production trước hoặc trong lúc
  làm phase này, vì toolchain TS mới cũng có thể đòi Node ≥20 — nhưng đây là quyết định hạ tầng riêng,
  cần bạn xác nhận trước khi đụng.
- Dockerfile do Nixpacks tự sinh truyền secrets qua `ARG`/`ENV` (Docker linter cảnh báo
  `SecretsUsedInArgOrEnv`) — vấn đề có sẵn, không liên quan TS, không tự sửa.

**Đã chốt (xác nhận với người dùng trước khi bắt đầu):**
- Chiến lược migrate: **dần theo module**, bắt đầu từ `src/core/` + `src/modules/request/` (đã có test
  bảo vệ đầy đủ), phần `.js` còn lại giữ nguyên qua `allowJs`.
- Strict mode: **bật dần từng flag** (bắt đầu `noImplicitAny`, thêm `strictNullChecks`... sau khi phần
  đã migrate ổn định), không bật `strict: true` ngay từ đầu.

- [x] 1.5.1 — Setup tooling, CHƯA đụng file code nào:
      - Thêm `devDependencies`: `typescript`, `ts-jest`, `@types/jest`, `@types/node@18` (pin đúng
        major 18, khớp Node production 18.20.5 đã xác nhận qua log Dokploy — KHÔNG dùng bản mới nhất
        `@types/node@26` dù đó là latest, vì sẽ khai báo API của Node 26 không tồn tại ở production).
        Verify tương thích trước khi cài: `typescript@7` yêu cầu Node ≥16.20, `ts-jest@29` yêu cầu Node
        18.x hoặc ≥20, `jest@30` (đã có sẵn) yêu cầu `^18.14.0 || ^20 || ^22 || >=24` — Node 18.20.5
        production thoả tất cả, không cần nâng Node chỉ vì TypeScript (khác với gap Node ≥20 của
        `mongodb`/`bson`/`mongodb-memory-server` đã ghi nhận ở trên, vẫn chưa đụng).
      - `tsconfig.json` mới ở root: `allowJs: true, checkJs: false` (chỉ .ts được type-check đầy đủ,
        .js pass-through nguyên trạng), `outDir: "dist"`, `rootDir: "."` (vì `index.js` nằm ở root,
        không phải trong `src/`), `module: "CommonJS"` (giữ nguyên `require`/`module.exports`, file
        `.ts` mới có thể dùng `import`/`export` — tsc tự biên dịch xuống CommonJS, không cần đổi cách
        `require()` ở các file `.js` khác), `noImplicitAny: true` (flag strict đầu tiên theo quyết định
        trên). **Lưu ý:** TypeScript 7 đã bỏ hẳn `moduleResolution: "node"` (`node10`) — không khai báo
        `moduleResolution`, để tsc tự chọn mặc định phù hợp với `module: "CommonJS"`.
      - `package.json`: thêm `"build": "tsc"`, đổi `"start": "node index.js"` →
        `"start": "node dist/index.js"`. Chưa đổi `"dev"` (vẫn `nodemon index.js` chạy thẳng .js) — sẽ
        cần đổi sang `ts-node` khi bắt đầu có file `.ts` thật (task sau).
      - `.gitignore`: thêm `dist/` (build artifact).
      - **Verify thật (không suy đoán):** `npm run build` chạy sạch (502 file output = 250 `.js` gốc ×
        2 vì kèm `.map`, cộng `index.js`+`.map` — đúng số lượng, không file nào bị bỏ sót dù chưa có
        `.ts` nào). Chạy thật `node dist/index.js` (không phải chỉ `--check`) — kết nối Redis + MongoDB
        thành công, chạy xong job đồng bộ folder, chỉ dừng ở bước `listen(2345)` vì cổng đã bị process
        dev khác chiếm — xác nhận toàn bộ path resolution (`require("./src/...")`, `dotenv` đọc `.env`
        theo cwd, `path.join(__dirname, "public")`...) hoạt động đúng từ `dist/` dù cấu trúc thư mục
        được mirror sang đó. `npm test` toàn repo: vẫn 347 pass / 17 fail, không đổi (chưa có gì dùng
        `ts-jest` nên chưa ảnh hưởng).

- [x] 1.5.2 — Wire `ts-jest` vào `jest.config.js` để chạy được `.test.ts`, giữ nguyên `.test.js` hiện có.
      - `testMatch` thêm `**/*.test.ts`; thêm `transform: { "^.+\\.tsx?$": ["ts-jest", {...}] }`.
      - **Bug thật phát hiện ngay khi thử (không phải suy đoán):** `typescript@7.0.2` (bản mới nhất,
        đã cài ở 1.5.1) là bản viết lại native, KHÔNG còn expose Compiler API kiểu JS mà `ts-jest`
        (bản `29.x`, dòng hiện tại duy nhất tương thích `jest@30`) cần — lỗi thẳng: *"does not expose
        the JavaScript compiler API required by ts-jest"*. Hạ xuống `typescript@6.0.3` (bản ổn định mới
        nhất dòng 6.x, dòng cũ mà `ts-jest` thực sự hỗ trợ) — build/type-check ở 1.5.1 verify lại vẫn
        hoạt động bình thường với bản này.
      - **Vấn đề thứ 2:** dùng chung `tsconfig.json` cho `ts-jest` bị thiếu global type của
        `@types/jest` (`test`/`expect` báo "Cannot find name") — do `tsconfig.json` gốc cố tình
        `exclude: ["__tests__"]` (đúng cho `npm run build`, không muốn build production kéo theo test).
        Tách riêng `tsconfig.test.json` (extends tsconfig gốc, `include` thêm `__tests__/**/*`,
        `types: ["jest","node"]`), trỏ `ts-jest` dùng file này thay vì `tsconfig.json`.
      - **Verify thật bằng file `.ts` tạm** (tạo rồi xoá ngay sau khi xác nhận, không phải suy luận):
        (1) test pass bình thường qua `ts-jest`; (2) cố tình truyền sai kiểu (`add("2", 3)`) — `ts-jest`
        báo đúng lỗi biên dịch `TS2345`, xác nhận type-check thật sự chạy chứ không chỉ transpile bỏ
        qua kiểu.
      - `npm test` toàn repo: vẫn 347 pass / 17 fail, không đổi.

- [x] 1.5.3 — Convert `src/core/ddd/` (5 file) sang `.ts`: `entity.base.ts`, `domain-event.base.ts`,
      `aggregate-root.base.ts`, `value-object.base.ts`, `command.base.ts`.

      **Thiết kế kiểu:** `Entity<Props extends object>`/`AggregateRoot<Props>`/`ValueObject<Props>`
      generic hoá theo props riêng từng subclass. `Entity`/`AggregateRoot`/`DomainEvent`/`ValueObject`
      đánh dấu `abstract class` (khớp đúng ý định thiết kế gốc — không dùng trực tiếp), nhưng
      **`validate()` vẫn giữ cụ thể (throw runtime), KHÔNG khai báo abstract thật sự** — vì subclass
      thật (`RequestEntity`) vẫn còn `.js` chưa convert, TS không type-check được nó; nếu `validate()`
      là abstract thật, TS sẽ xoá hẳn method khỏi output biên dịch, mất luôn lưới an toàn runtime hiện
      tại (`Entity.validate() must be implemented...`) mà không có gì bù lại cho code `.js` chưa gõ
      kiểu. Giữ nguyên đúng hành vi cũ, chỉ nâng cấp kiểu — sẽ cân nhắc chuyển hẳn sang abstract khi
      chính `RequestEntity` convert sang `.ts` (task sau).

      **Dependency mới:** `@types/lodash` (cho `value-object.base.ts` dùng `import isEqual from
      "lodash/isEqual"` đúng kiểu thay vì `require()` bỏ qua type-check).

      **Vấn đề vận hành thật phát hiện + fix (không phải suy đoán):** các file domain event con
      (`request-created.domain-event.js`...) vẫn `.js`, `require()` thẳng `domain-event.base` — khi file
      đó đổi sang `.ts`, `node index.js`/`nodemon` (script `dev` cũ) KHÔNG tự hiểu được `.ts`, sẽ vỡ ngay.
      Thêm `ts-node`, đổi `"dev": "nodemon index.js"` → `"dev": "nodemon -r ts-node/register/transpile-only index.js"`
      (`transpile-only` để không chậm mỗi lần nodemon restart — type-check đầy đủ đã có ở
      `npm run build`/`npm test`/editor). Verify thật: boot cả qua `dist/index.js` (build) lẫn qua
      `ts-node` (dev) — cả 2 đều kết nối Redis/Mongo, chạy xong cron sync folder, listen cổng thành
      công.

      **Gap thứ 2 phát hiện:** ESLint hiện tại **không hề lint file `.ts`** (`eslint .`/`npm run lint`
      mặc định chỉ quét `.js`, `.ts` bị bỏ qua im lặng, không báo lỗi gì). Thêm
      `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin@7` + `eslint-config-airbnb-typescript`
      (bản tương thích `eslint@8.57`/airbnb-base đang dùng) qua `overrides` cho `**/*.ts` trong
      `.eslintrc.json`, dùng `tsconfig.test.json` cho type-aware lint. 2 vấn đề phụ lộ ra khi bật lint
      cho `.ts`: (1) `import/no-unresolved` — file `.js` cũ `require()` module giờ là `.ts` không
      resolve được — fix bằng `settings.import/resolver.node.extensions` thêm `.ts`; (2)
      `import/extensions` đòi khai rõ đuôi `.ts` — fix bằng rule `{js:"never", ts:"never"}` (khớp quy
      ước extensionless-require có sẵn). Đổi script `lint`/`lint:fix` thêm `--ext .js,.ts`. Verify: tổng
      số lỗi lint toàn repo **giữ nguyên 4266** (pre-existing, không liên quan) dù bật `--ext .ts` hay
      không — xác nhận phần `.ts` mới hoàn toàn sạch, không phát sinh thêm.

      **Verify tổng:** từng file có test riêng (`entity.test.js` 11, `domain-event.test.js` 6,
      `aggregate-root.test.js` 7, `value-object.test.js` 11, `command.test.js` 6 — tổng 41 test, đều
      pass không sửa 1 dòng). `npm test` toàn repo: 347 pass / 17 fail, không đổi. `npm run build` +
      boot `dist/index.js` thành công. `npm run lint` sạch (không thêm lỗi mới).

      **Sửa tiếp theo góp ý người dùng — gom type dùng chung, tránh khai trùng:** review lại phát hiện
      `DomainEventMetadata` (trong `domain-event.base.ts`) và `CommandMetadata` (trong `command.base.ts`)
      là **2 type giống hệt nhau** (`correlationId?/causationId?/timestamp/userId?`) — khai trùng vì mỗi
      file được viết độc lập, không tra lại type đã có. Tạo `src/core/ddd/types.ts` chứa 2 type thực sự
      dùng chung ≥2 nơi: `Metadata` (gộp 2 type trùng), `EventBus` (trước ở `aggregate-root.base.ts`,
      bản chất là hợp đồng chung cho mọi nơi publish event sau này). Type chỉ dùng đúng 1 file
      (`EntityConstructorProps`, `EntityOptions`, `DomainEventProps`, `DomainPrimitive`, `CommandProps`)
      **giữ nguyên tại chỗ khai báo** — không dồn vào `types.ts` vì không lặp lại ở đâu khác, dồn vào chỉ
      thêm gián tiếp không cần thiết. `types.ts` cố tình **không** import ngược bất kỳ file class nào
      trong `ddd/` (vd `EventBus.emitAsync`'s param kiểu `object` thay vì import `DomainEvent`) — nếu
      import ngược sẽ tạo vòng phụ thuộc (`types.ts` → `domain-event.base.ts` → `types.ts`); nơi cần kiểu
      cụ thể hơn (`aggregate-root.base.ts`) tự thắt chặt lại khi dùng.

      **Quy ước từ giờ (áp dụng cho mọi task convert `.ts` sau này, không riêng `core/ddd/`):**
      1. Trước khi khai 1 interface/type mới, kiểm tra `types.ts` cùng cấp thư mục + các file `.ts`
         khác trong cùng thư mục xem đã có type cùng hình dạng chưa (không chỉ trùng tên, mà trùng cấu
         trúc field).
      2. Nếu phát hiện trùng/gần trùng: quyết định (a) dùng lại y nguyên type đã có, (b) tổng quát hoá
         type đã có để phục vụ cả 2 chỗ (như `Metadata` ở trên), hoặc (c) giữ tách riêng NẾU có lý do
         nghiệp vụ thật sự khác nhau dù cấu trúc giống — phải ghi rõ lý do tại sao không gộp.
      3. Mỗi thư mục con của `core/` (và sau này mỗi `module/<name>/domain|application|...`) có
         `types.ts` **riêng** khi cần — không dồn toàn bộ repo vào 1 file `types.ts` chung (tránh phình
         to + coupling chéo giữa các phần vốn độc lập).

      **Bảng kiểm kê type dùng chung hiện tại** (cập nhật mỗi khi thêm/gộp type mới):

      | File | Type | Dùng bởi |
      |---|---|---|
      | `core/ddd/types.ts` | `Metadata` | `DomainEvent`, `Command` |
      | `core/ddd/types.ts` | `EventBus` | `AggregateRoot.publishEvents()` |

      Verify lại sau khi gộp: `npx tsc --noEmit` sạch, `eslint src/core/ddd/` sạch, 82 test
      `__tests__/core/` pass, `npm test` toàn repo 347/17 không đổi, `npm run build` thành công.

- [x] 1.5.4 — Convert 9 file còn lại của `src/core/`: `exceptions/exception.base.ts`,
      `exceptions/exceptions.ts`, `context/request-context.ts`, `events/event-bus.ts`,
      `db/mongoose-repository.base.ts`, `db/run-in-transaction.ts`, `http/async-handler.ts`,
      `http/handle-exception.ts`, `http/error-handler.middleware.ts`, `http/parse-pagination.ts`.
      `src/core/` giờ 100% `.ts`, không còn file `.js` nào.

      **Dependency mới:** `@types/express@4` (khớp `express@^4.19.2` đang dùng — bản mới nhất
      `@types/express` là dòng 5.x cho Express 5, phải pin dòng 4.x tương ứng). `ExceptionBase` đánh
      dấu `abstract class` với `code`/`statusCode` là `abstract` property thật (khác với `validate()`
      của Entity/ValueObject) — an toàn vì không có nơi nào `new ExceptionBase(...)` trực tiếp (đã grep
      xác nhận), và mọi subclass hiện tại đều implement đủ 2 field qua class field initializer.

      **BUG THẬT phát hiện qua chạy `npm test` TOÀN REPO (không phải qua test riêng của file) — bài
      học quan trọng:** khi convert `async-handler.js`, đã vô tình đổi arrow function từ **expression-
      body** (`(req,res,next) => Promise.resolve(fn(...)).catch(next)` — tự động `return` promise
      chain) sang **block-body** (`{ Promise.resolve(...).catch(next); }` — tự động `return undefined`).
      Production (Express) không quan tâm giá trị trả về nên KHÔNG lộ lỗi gì — nhưng helper
      `callController` (viết ở task 1.15 để port `requestControllerCreate.test.js`/
      `requestApprovalFlow.test.js`) dựa vào đúng giá trị trả về đó để `await` cho xong việc async bên
      trong, nên khi mất, `await callController(...)` resolve ngay lập tức (trước khi service chạy
      xong) — **41 test fail** (tăng từ 17 lên 41, đúng 2 file test vừa port ở 1.15 vỡ hoàn toàn). Chỉ
      82 test `__tests__/core/` (chạy riêng lẻ theo từng file) đều xanh — không phát hiện được vì
      không có test nào assert trực tiếp giá trị trả về của `asyncHandler`. Đây chính là lý do phải luôn
      chạy `npm test` TOÀN REPO sau mỗi file, không chỉ test riêng của file đó.

      **Fix:** khai kiểu trả về trung thực `(req,res,next) => Promise<void>` (không dùng `RequestHandler`
      của `@types/express` — type đó ngầm định `void`, không phản ánh đúng việc hàm này CÓ trả về
      Promise, thứ mà test harness cần dựa vào), dùng `.then(() => undefined, (error) => next(error))`
      thay cho `.catch(next)` để cả 2 nhánh (thành công/lỗi) đều resolve về `undefined` — khớp kiểu khai
      báo mà không cần ép kiểu (`as`).

      **Verify sau khi fix:** `npm test` toàn repo trở lại đúng 347 pass / 17 fail. `npm run build` +
      boot `dist/index.js` thành công. `npm run lint` toàn repo vẫn 4266 vấn đề (pre-existing, không
      đổi). `find src/core -name "*.js"` trả về rỗng — xác nhận `core/` 100% `.ts`.

      **Kiểm tra type trùng lặp (theo quy ước đã ghi ở 1.5.3):** phát hiện 1 cặp gần giống —
      `PaginationParams`/`PaginatedResult` (`db/mongoose-repository.base.ts`) và `PaginationQuery`/
      `PaginationResult` (`http/parse-pagination.ts`). **Quyết định giữ tách riêng, không gộp** — khác
      tầng thật sự: 1 bên là kết quả đã parse từ query string HTTP (`skip` tính sẵn, input `unknown`
      chưa validate), bên kia là tham số đầu vào cho repository (chỉ `limit`/`page`, không cần `skip`
      vì tự tính bên trong). Không phải khai trùng vô ý như `Metadata` ở 1.5.3.

- [x] 1.5.5 — Convert `src/config/logger.ts` (ngoài phạm vi `core/`+`modules/request/` đã định, làm theo
      yêu cầu riêng của người dùng) + wire vào 2 chỗ trước đó chưa dùng logger nào:

      **Phát hiện trước khi làm (trả lời câu hỏi người dùng):** `logger.js` được viết sẵn nhưng
      **chưa được require ở bất kỳ đâu trong repo** (grep xác nhận). Hệ thống log thật hiện tại là 212
      lệnh `console.log/error/warn` rải rác không format thống nhất + `morgan("dev")` chỉ log access
      HTTP, khác concern. So sánh: `logger.js` tốt hơn ở format thống nhất, phân stdout/stderr theo
      level, `debug()` tự tắt production, `serializeMeta` an toàn khi log object phức tạp — nhưng chưa
      tận dụng được 2 hạ tầng đã có sẵn từ Phase 0/1.5: `RequestContextService` (chưa tự gắn
      correlationId) và error-handling middleware (chưa log gì cả, lỗi 500 chỉ client thấy).

      **Convert + cải thiện:**
      - `logger.ts`: thêm `RequestContextService.getRequestId()` vào mỗi dòng log (`[timestamp] [LEVEL]
        [requestId] message {meta}` — bỏ qua phần `[requestId]` nếu gọi ngoài request context, vd cron
        job). Verify thật bằng script gọi trực tiếp qua `ts-node`: có context → có requestId, không
        context → không có, đúng format.
      - `core/http/error-handler.middleware.ts`: gọi `logger.error(message, {stack})` — **chỉ log khi
        lỗi thật sự bất ngờ** (`statusCode >= 500` hoặc không phải `ExceptionBase`). Lỗi nghiệp vụ đã
        biết (400/403/404/409 — `NotFoundException`, `ForbiddenException`...) là luồng bình thường,
        cố tình KHÔNG log để tránh nhiễu (hàng chục test trong suite tạo ra các lỗi 4xx này có chủ đích,
        nếu log hết sẽ ngập log mỗi lần chạy test/production mà không có giá trị gì).

      **Verify:** chạy toàn bộ `npm test` — 0 dòng `[ERROR]` xuất hiện trong output (xác nhận không
      test nào assert lỗi 500 thật, không bị nhiễu log). `npm test` toàn repo: 347 pass / 17 fail,
      không đổi (1 lần chạy ra 18 fail do 1 test khác flaky khi chạy song song — chạy lại 2 lần liền sau
      đó đều về đúng 347/17, xác nhận không phải regression thật). `npm run build` + `npm run lint`
      (4266, không đổi) đều sạch.

- [x] 1.5.6 — Dọn dead code phát hiện qua câu hỏi người dùng: `RequestNotFoundError`
      (`domain/request.errors.js`, định nghĩa từ task 1.2) chưa từng được dùng — 4 chỗ "đơn không tồn
      tại" (`review-request.service.js` x2, `cancel-request.service.js`, `get-request-by-id.service.js`)
      đều dùng `NotFoundException` chung với message viết tay lặp lại, thay vì class riêng đã có sẵn.
      Lý do khả dĩ: 3 exception khác cùng file (`CannotSelfReviewError`, `AlreadyReviewedError`,
      `InvalidStatusTransitionError`) đều là invariant entity tự ném về CHÍNH NÓ nên tự nhiên được dùng
      trong `request.entity.js`; riêng "không tồn tại" là việc của tầng application (sau khi repository
      lookup thất bại, trước khi entity kịp tồn tại) nên không ai nhớ quay lại dùng class riêng.

      Thay cả 4 chỗ bằng `new RequestNotFoundError()` (message mặc định giống hệt), giữ nguyên
      `NotFoundException` ở 2 chỗ khác dùng cho "Không tìm thấy thông tin nhân viên" (không phải request
      not-found, không đổi).

      **Verify nghi vấn của người dùng ("không chạy vào errorHandlerMiddleware") bằng HTTP thật, không
      suy luận:** viết script tạm dựng đúng Express app thật (`request.routes.js` +
      `errorHandlerMiddleware` thật, không mock 2 cái này) qua `supertest`, gọi `PATCH /requests/
      review/:id` và `PATCH /requests/cancel/:id` với id không tồn tại — cả 2 trả đúng
      `404 {message: "Đơn không tồn tại"}`, xác nhận `RequestNotFoundError` (kế thừa `ExceptionBase`
      giống `NotFoundException`) chạy đúng qua `errorHandlerMiddleware` thật, không có vấn đề routing
      nào. `get-request-by-id.http.test.js` (test có sẵn, cũng dựng Express thật) tiếp tục pass, cùng
      xác nhận endpoint thứ 3. Xoá script tạm sau khi xác nhận xong.

      `npm test` toàn repo: 347 pass / 17 fail, không đổi.

- [x] 1.5.7 — 2 fix nhỏ về logger, phát hiện qua người dùng tự chạy `npm run dev` và test tay:

      **Format log xấu hơn `loggingMiddleware.js` có sẵn:** `logger.ts` cũ nối `JSON.stringify(meta)`
      vào chung 1 dòng chuỗi trước khi `console.log`, ra 1 dòng JSON dày đặc — khác với
      `loggingMiddleware.js` (file có sẵn, không phải của migration này) truyền object thô làm tham số
      riêng cho `console.log(prefix, object)`, để Node tự pretty-print nhiều dòng/thụt lề. Sửa `print()`
      trong `logger.ts` theo đúng cách đó — bonus: bỏ được `serializeMeta`/try-catch JSON.stringify,
      không còn rủi ro crash khi `meta` có circular reference. Verify bằng script gọi trực tiếp qua
      `ts-node` — output giờ nhiều dòng, đẹp, giống `loggingMiddleware.js`.

      **BUG THẬT phát hiện qua người dùng tự test — nodemon không theo dõi file `.ts`:** từ task 1.5.3,
      script `dev` đổi thành `nodemon -r ts-node/register/transpile-only index.js` nhưng **quên báo
      nodemon theo dõi thêm đuôi `.ts`** — verify bằng cách chạy thật `npm run dev`, nodemon tự in ra
      `watching extensions: js,mjs,cjs,json` (không có `ts`), xác nhận sửa file `.ts` KHÔNG kích hoạt
      restart — dev server chạy code cũ, đúng như người dùng quan sát ("sửa `error-handler.middleware.ts`
      không thấy log mới"). Fix: thêm `--ext js,mjs,cjs,json,ts` vào script `dev`. Verify lại: nodemon in
      đúng `watching extensions: js,mjs,cjs,json,ts`, chạm file `.ts` → `[nodemon] restarting due to
      changes...` xuất hiện đúng.

      **Lưu ý quan trọng cho các task 1.5.x sau này:** đây là gap đã tồn tại từ 1.5.3 tới giờ (nhiều
      task convert file `.ts` trong `core/` đã đi qua) mà không ai phát hiện vì luôn verify qua
      `npm test`/`npm run build`/boot thủ công (`node dist/index.js` hoặc `node -r ts-node/register`),
      không ai thực sự chạy `npm run dev` (nodemon) trong lúc convert. Không cần sửa gì thêm ở các task
      cũ (không ảnh hưởng build/test/production, chỉ ảnh hưởng trải nghiệm dev local).

      `npm test` toàn repo: 347 pass / 17 fail, không đổi. `npm run build` sạch.

- [x] 1.5.8 — Sửa phân cấp kế thừa của 4 exception ở `domain/request.errors.js` + truyền `metadata`
      vào các nơi ném lỗi, theo góp ý người dùng (câu hỏi: "sao không kế thừa NotFoundException mà lại
      ExceptionBase"):

      **Đổi parent class** (trước đó cả 4 đều `extends ExceptionBase` trực tiếp — thiếu sót từ task
      1.2, không phải quyết định có chủ đích, xác nhận bằng grep không có chỗ nào check
      `instanceof NotFoundException`/`ForbiddenException`/`ConflictException` cụ thể nên đổi parent an
      toàn):
      - `CannotSelfReviewError` (403) → `extends ForbiddenException`
      - `AlreadyReviewedError` (409) → `extends ConflictException`
      - `InvalidStatusTransitionError` (409) → `extends ConflictException`
      - `RequestNotFoundError` (404) → `extends NotFoundException`

      Mỗi class giờ chỉ cần khai `code` riêng (`REQUEST.*`), không cần lặp `statusCode` — tự kế thừa từ
      parent. Verify thật thứ tự khởi tạo class field qua kế thừa 2 tầng (không suy đoán): script gọi
      `new E()` cho cả 4 class, in `code`/`statusCode` — đúng cả 2: `code` là giá trị riêng
      (`REQUEST.CANNOT_SELF_REVIEW`...), `statusCode` đúng giá trị kế thừa (403/409/409/404).

      **Thêm `metadata` vào các nơi ném lỗi** để log có ngữ cảnh hữu ích hơn (không thêm `cause` — cả 4
      lỗi đều ném trực tiếp từ kiểm tra nghiệp vụ, `if (...) throw ...`, không có lỗi cấp thấp hơn nào
      "gây ra" nó để gán vào `cause`, gán bừa sẽ sai ý nghĩa của field):
      - `CannotSelfReviewError`: `{ requestId, userId, reviewerId }` (`request.entity.js`,
        `_assertNotSelfReview`)
      - `AlreadyReviewedError`: `{ requestId, reviewerId }` (`request.entity.js`, `approve()`)
      - `InvalidStatusTransitionError`: `{ requestId, currentStatus }` (`request.entity.js`,
        `_assertPending`)
      - `RequestNotFoundError`: `{ requestId: id }` ở cả 4 chỗ ném (`review-request.service.js` x2,
        `cancel-request.service.js`, `get-request-by-id.service.js`)

      Verify: `npm test` toàn repo 347/17 không đổi (42 test riêng của module `request` liên quan các
      file đã sửa đều pass). Verify log thật bằng script gọi trực tiếp: `metadata` hiện đúng trong
      output pretty-print (nhờ fix 1.5.7), `cause: undefined` đúng như dự kiến (không có gì để gán).

**Definition of done (sơ bộ, sẽ chi tiết hoá khi bắt đầu):** build qua Nixpacks thành công trên 1 lần
deploy thử (không sửa cấu hình Dokploy), `npm test` xanh với `ts-jest` hoặc tương đương, không giảm số
test pass.

- [x] 1.6 — Convert toàn bộ `src/modules/request/` (24 file) sang `.ts`: `domain/` (11: 5 domain event,
      `request.entity.ts`, `request.errors.ts`, `approval-chain.ts`, `request-type-handlers.ts`,
      `request-type-labels.ts`, `resolve-reviewer-profile.ts`, + `types.ts` mới), `infrastructure/` (2:
      `request.mapper.ts`, `request.repository.ts`), `application/` (9), `interface/` (2:
      `request.http.controller.ts`, `request.routes.ts`). `src/modules/request/` giờ 100% `.ts`.

      **Thiết kế kiểu chính:**
      - `RequestProps` (trong `types.ts`) gộp field của cả 7 loại đơn thành **1 interface**, chỉ
        `COMMON_FIELDS` bắt buộc, còn lại optional — KHÔNG dùng discriminated union theo `request_type`
        dù "đúng chuẩn" hơn, vì `RequestEntity` vốn là **1 class duy nhất xử lý động cả 7 loại** (không
        phải 7 subclass), ép kiểu theo union sẽ đấu tranh ngược lại thiết kế thật, còn `validate()` của
        entity đã tự kiểm tra field-theo-loại lúc runtime rồi (xem `REQUEST_TYPE_FIELDS`).
      - `RequestTypeHandler` (chữ ký lỏng `(...args: any[]) => any`) vì `helpers/*Handler.js` (7 file)
        nằm ngoài phạm vi module `request`, chưa convert — không giả vờ chính xác cho thứ chưa gõ kiểu.
      - `account`/`body`/tham số từ Mongoose document populate (`request.user_id._id`...) dùng `any`
        có chủ đích ở nhiều chỗ — cùng lý do: `middlewares/authMiddleware.js`, `models/*.js` chưa
        convert, ép kiểu chính xác cho input từ code chưa gõ kiểu chỉ tạo ảo giác an toàn.
      - `src/core/http/express.d.ts` (mới) — augment `Express.Request.account` (property tuỳ biến do
        `authMiddleware.js` gắn, Express gốc không có) — làm 1 lần dùng chung cho MỌI controller sau
        này, không riêng module `request`.

      **Gộp type trùng lặp phát hiện thêm** (theo quy ước 1.5.3): `ReviewerProfile`
      (`resolve-reviewer-profile.ts`) và shape trả về của `buildCandidate` (`approval-chain.ts`) giống
      hệt nhau trừ field `accountId` — gộp thành `ReviewerProfile` (dùng chung, trong `types.ts`) +
      `ApprovalCandidate extends ReviewerProfile { accountId }` (riêng `approval-chain.ts`).
      `RequestFilter` (`request-query-filters.ts`) cũng được export để `get-my-requests.service.ts`/
      `get-all-requests.service.ts` dùng chung thay vì tự khai lại.

      **Sự cố thật bắt được TRƯỚC KHI gây regression (nhờ verify từng bước, không phải may mắn):**
      convert `request.routes.ts` lúc đầu viết `export default router;` — nhưng file gốc là
      `module.exports = router;` (bare value, không object) trong khi TẤT CẢ 23 file khác đều
      `module.exports = { Tên };` (named, object-wrapped). Với `esModuleInterop`, `export default`
      biên dịch thành `exports.default = router` — phá vỡ 5 nơi `.js`/test đang `require()` thẳng lấy
      router (không phải `.default`). Rà lại **toàn bộ 24 file** qua `git show HEAD:<path>` để xác nhận
      chỉ đúng 1 file này có pattern khác biệt — sửa thành `export = router;` (cú pháp CommonJS-export
      riêng của TS, biên dịch đúng thành `module.exports = router` 1:1). Verify bằng cách build thật rồi
      đọc trực tiếp file `.js` biên dịch ra, xác nhận đúng `module.exports = router;`, không có
      `.default`.

      **Việc phụ xử lý trong lúc convert (theo yêu cầu người dùng):** xoá dòng debug
      `logger.info("An unexpected error occurred", ...)` không điều kiện còn sót lại trong
      `error-handler.middleware.ts` (người dùng tự thêm lúc test tay ở 1.5.8, quên dọn) — đúng ý thiết
      kế "chỉ log lỗi ≥500" đã thống nhất.

      **eslint config sửa thêm 2 chỗ** (áp dụng chung, tránh lặp lại cho các module sau):
      `@typescript-eslint/naming-convention: off` — `airbnb-typescript/base` mặc định đòi camelCase,
      xung đột với snake_case field DB (`request_type`, `user_id`...) dùng xuyên suốt codebase (đã tắt
      cho `.js` qua `camelcase: off` từ trước, giờ tắt tương đương cho `.ts`).

      **Verify tổng:** 93 test module `request` pass nguyên vẹn không sửa dòng nào. `npm test` toàn
      repo: 347 pass / 17 fail — xác nhận ổn định qua nhiều lần chạy (1 lần ra 29 fail do nhiều test
      flaky khác chạy song song, không liên quan — chạy lại 2 lần liền sau đó đều đúng 347/17).
      `npm run build` + boot `dist/index.js` thành công (tới đúng bước `listen()`, chỉ dừng vì port đã
      bị server thật của người dùng giữ). `npm run lint` toàn repo vẫn 4266 vấn đề, không đổi.
      `find src/modules/request -name "*.js"` trả về rỗng.

## 9. Phase 1.7 — Dọn nợ kỹ thuật WorkDayStatus (ranh giới Request ↔ Attendance)

**Bối cảnh:** sau khi Phase 1 + 1.5 xong, bàn tiếp về ranh giới Request↔Attendance (do người dùng chủ
động nêu lại). Trace code thật (không suy đoán) cho thấy `WorkSheetModel`/`WorkDayStatusModel` được cả
2 module ghi trực tiếp. Qua nhiều vòng verify — **kể cả tự đính chính 2 nhận định sai** — bức tranh
chính xác cuối cùng:

- `WorkDayStatus` có **2 chế độ hợp lệ, cùng tồn tại**: *attendance-driven* (`pending`/`present`/
  `missed_clock`/`absent` — chấm công thật quyết định, an toàn tính lại toàn bộ qua
  `resolveAttendanceDay`) và *decision-driven* (`leave_paid`/`leave_unpaid`/`remote`/`business_trip`/
  `client_visit` — đơn được duyệt quyết định, ghi 1 lần, miễn nhiễm với tính lại trừ khi
  `resolveLeaveConflictOnAttendance` chủ động override). **Thiết kế 2 chế độ này hợp lý, không phải
  lỗi.**
- `AttendanceController.checkOut`'s cập nhật đơn giản (`updateMany({status:"pending"}→{status:"present"})`)
  **không phải bug/bản sao cạnh tranh** như nhận định ban đầu — nó là cập nhật tạm thời tức thời, cron
  `finalizeWorkDay.js` (chạy 23h mỗi tối, dùng đúng `resolveAttendanceDay`/`saveAttendanceDay`) mới là
  bản chốt authoritative. Đây là thiết kế 2 pha có chủ đích.
- `LeaveBalance` (`helpers/leaveBalance.js`) **không có vấn đề tương tự** — `adjustLeaveBalance` đã là
  điểm vào duy nhất thật (Redis lock + invariant không-âm), dùng bởi ≥4 nơi (Request, User, 2 cron job)
  qua đúng 1 implementation — đúng chuẩn Domain Service cross-cutting theo quy tắc mục 3/5, giữ nguyên,
  không đụng.

**Vấn đề thật, còn lại sau khi loại bỏ 2 nhận định sai ở trên:**

1. Việc phân loại "status nào thuộc chế độ nào" định nghĩa **3 lần độc lập**, phạm vi hơi khác nhau,
   dễ lệch khi thêm loại đơn mới:
   - `AWAY_STATUSES` (`leaveHandler.js`) = `["business_trip","client_visit","remote"]` — thực ra là
     tập con hẹp hơn: "status nào có ghi `check_in`/`check_out` giả cần xoá khi ghi đè" (không gồm
     `leave_paid`/`leave_unpaid` vì 2 loại đó không set giờ chấm công giả).
   - `NON_DERIVABLE_STATUSES` (`attendanceHelper.js`, hàm `correctDayStatuses`) = 5 status decision-driven
     đầy đủ.
   - `OVERRIDABLE` (`attendanceHelper.js`, hàm `persistAttendanceDay`) = 4 status attendance-driven —
     xác nhận đúng là phần bù chính xác của `NON_DERIVABLE_STATUSES` (verify qua enum đầy đủ 9 status ở
     `models/WorkDayStatusModel.js`, không thiếu/thừa).
2. `resolveLeaveConflictOnAttendance` (luật nối 2 chế độ) sống trong `leaveHandler.js` (file Request)
   dù được gọi từ `attendanceHelper.js` VÀ `AttendanceController.js` (2 nơi phía Attendance) —
   `attendanceHelper.js` hiện phải `require("./leaveHandler")` ngược để lấy hàm này — sai hướng phụ
   thuộc.
3. `attendanceHelper.js` (418 dòng) trộn lẫn parse-Excel (`parseExcelToBlocks`/`parseDayRows`, I/O
   thuần) với logic tính toán ngày công (`resolveAttendanceDay`/`persistAttendanceDay`) — không liên
   quan nhau, khó đọc chung 1 file.

**Quyết định — chọn phạm vi thu hẹp (không tạo module `modules/workday/` mới):** đã cân nhắc phương án
xây hẳn 1 module DDD mới (`domain/infrastructure/application` như `request`) nhưng **từ chối cho bây
giờ** — rủi ro cao hơn lợi ích vì (a) chưa hiểu hết toàn bộ `AttendanceController.js` (chưa migrate),
dễ thiết kế sai ranh giới; (b) sau khi đính chính, phạm vi lỗi thật nhỏ hơn nhiều so với tưởng ban đầu,
không cần đến mức xây module riêng. Việc DDD hoá đầy đủ dời tới Phase 8 thật (khi đã có đủ thông tin).
Bây giờ chỉ dọn đúng 3 vấn đề đã xác nhận, **giữ nguyên vị trí file trong `helpers/`**, không đổi
logic nghiệp vụ (ngưỡng giờ, điều kiện override, cách tính hoàn phép) — chỉ đổi cách tổ chức code.

**Cấu trúc thư mục liên quan (không thêm thư mục mới, chỉ thêm 2 file nhỏ trong `helpers/` và tách 1
file):**

```
src/helpers/
  workDayStatusRules.js        # MỚI — nguồn duy nhất: bảng phân loại 9 status (attendance-driven vs
                                # decision-driven vs có-set-giờ-chấm-công-giả), suy ra 3 hằng số
                                # ATTENDANCE_DRIVEN_STATUSES/DECISION_DRIVEN_STATUSES/
                                # STATUSES_WITH_SYNTHETIC_ATTENDANCE từ 1 bảng — thêm status mới chỉ
                                # sửa đúng 1 chỗ
  attendanceExcelImport.js      # MỚI — tách parseExcelToBlocks/parseDayRows ra khỏi attendanceHelper.js
                                # (I/O đọc file Excel, không liên quan tính toán ngày công)
  attendanceHelper.js           # SAU KHI TÁCH — chỉ còn logic tính toán thuần (resolveAttendanceDay,
                                # normalizeDayPunches, persistAttendanceDay, saveAttendanceDay,
                                # correctDayStatuses) + resolveLeaveConflictOnAttendance (di dời vào,
                                # xem dưới) — import ATTENDANCE_DRIVEN_STATUSES/NON_DERIVABLE từ
                                # workDayStatusRules.js thay vì tự khai
  leaveHandler.js               # resolveLeaveConflictOnAttendance CHUYỂN ĐI (import lại từ
                                # attendanceHelper.js) — đảo chiều phụ thuộc đúng: leaveHandler.js
                                # (Request) phụ thuộc attendanceHelper.js (Attendance-side), không phải
                                # ngược lại như hiện tại. AWAY_STATUSES import từ
                                # STATUSES_WITH_SYNTHETIC_ATTENDANCE (workDayStatusRules.js)
  awayDayHandler.js             # cập nhật import resolveLeaveConflictOnAttendance từ attendanceHelper.js
                                # thay vì leaveHandler.js
```

`controllers/AttendanceController.js` cập nhật 2 import (`resolveLeaveConflictOnAttendance` từ
`attendanceHelper.js` thay vì `leaveHandler.js`; `parseExcelToBlocks`/`parseDayRows` từ
`attendanceExcelImport.js`) — không đổi logic gì khác trong file này (vẫn nguyên, chưa tới lượt Phase 8).

**Backlog, chưa làm ngay (rủi ro cao hơn, cần bàn riêng khi có thời gian):** `leaveHandler.onApprove`
(~95 dòng) và `awayDayHandler.createOnApprove` cùng có phần khung việc giống nhau (tìm/tạo `WorkSheet`
theo range ngày, rồi upsert `WorkDayStatus`) — đáng rút thành 1 hàm dùng chung, nhưng 2 nơi có logic
gán ca (shift) khác nhau thật (leaveHandler xử lý cả part-time qua `resolveShiftsForDates`, awayDayHandler
chỉ dùng ca hành chính/ca sáng cố định) — cần phân tích kỹ hơn trước khi rút, không làm vội trong đợt
dọn nợ này.

- [x] 1.7.1 — `helpers/workDayStatusRules.ts` (file mới, viết thẳng `.ts` theo yêu cầu người dùng — từ
      nay file mới/sửa đều `.ts`): bảng phân loại 9 status + 3 hằng số suy ra
      (`ATTENDANCE_DRIVEN_STATUSES`/`DECISION_DRIVEN_STATUSES`/`STATUSES_WITH_SYNTHETIC_ATTENDANCE`).
      Verify thật: cả 3 hằng số suy ra khớp CHÍNH XÁC 3 danh sách cũ (`OVERRIDABLE`,
      `NON_DERIVABLE_STATUSES`, `AWAY_STATUSES`) qua script so sánh set — không suy đoán. Convert luôn
      `attendanceHelper.js` → `.ts` (đang sửa nên chuyển theo yêu cầu mới), cập nhật import 2 hằng số từ
      file mới thay vì tự khai. Verify: `attendanceMerge.test.js` cho đúng 4 fail y hệt trước/sau (so
      sánh qua `git stash`), `npm test` toàn repo 347/17 không đổi, build sạch.
- [x] 1.7.2 / 1.7.3 — **SUPERSEDED, không làm riêng nữa** — theo quyết định người dùng, gộp hẳn vào
      Phase 1.8 (mục 14): thay vì chỉ di dời `resolveLeaveConflictOnAttendance` sang `attendanceHelper.ts`
      (bản vá tạm trong cấu trúc cũ), làm đúng 1 lần trong `modules/timesheet/domain/policies/
      leave-attendance-conflict.ts` theo kiến trúc dài hạn đã chốt ở mục 13. Việc tách Excel-parsing
      (1.7.3) cũng tự nhiên rơi vào `modules/attendance/infrastructure/` khi build module đó (mục 14,
      sub-phase 1.8.4) — không cần task riêng trong cấu trúc cũ nữa.

**Definition of done (đã đạt được với riêng 1.7.1):** phân loại status có 1 nguồn duy nhất, dùng làm
nền cho `modules/timesheet/domain/work-day-status.ts` sau này (mục 14). Phần còn lại của Phase 1.7 dừng
ở đây — xem mục 14 cho phần tiếp theo.

## 10. Phase 2+ — Các module còn lại

Giữ nguyên thứ tự rủi ro × đòn bẩy đã khảo sát. Mỗi module áp khuôn 12-13 task như Phase 1, **chi tiết
hoá khi bắt đầu module đó** (không lập chi tiết trước cho cả 7 module — tránh lập kế hoạch cho thứ có
thể đổi sau khi rút kinh nghiệm từ Phase 1).

| # | Module | Điểm khác biệt cần lưu ý |
|---|---|---|
| 2 | `internal-file` | 0 test hiện tại → viết characterization test TRƯỚC khi viết entity/repository |
| 3 | `user` | Entity trung tâm — migrate từng route/use-case một, không migrate cả file 1 lần |
| 4 | `department` | Nền tảng cho `approvalChain` — không đổi field mà nó phụ thuộc |
| 5 | `weekly-report` | Value Object cho status-flow (giống `resolveAttendanceDay`) |
| 6 | `chat` | Quyết định phạm vi module (hrm/workplace/platform-wide) TRƯỚC khi domain modeling |
| 7 | `post`, `labor-contract` | Rủi ro thấp, cùng khuôn Phase 1 |
| 8 | `attendance` | Logic phần lớn đã an toàn (helper có test) — chủ yếu di dời cấu trúc; ghi chú idempotency nếu sau này có webhook máy chấm công. **Ràng buộc sâu với `request` (lateEarly/forgotCheckin handler) đã bàn kỹ ở mục 7, phần backlog task 1.11 — xem trước khi bắt đầu module này.** Phase 1.7 (mục 9) đã dọn trước 3 điểm nợ kỹ thuật cụ thể (phân loại status, vị trí `resolveLeaveConflictOnAttendance`, tách Excel-parsing) — khi tới Phase 8 chỉ còn việc DDD hoá cấu trúc (`domain/infrastructure/application`), không cần lo lại phần đã dọn. Quyết định có tạo `modules/workday/` (đã bàn, từ chối tạm thời ở Phase 1.7) để lại cho lúc này. |

## 11. Verification (lặp lại sau mỗi task)

1. `node --check <file vừa tạo/sửa>`
2. `npm test` — số test pass tăng hoặc giữ nguyên, không giảm, không sửa test cũ để "cho pass"
3. `npm run lint` sạch trên file vừa đụng
4. `git diff` — review trước khi sang task tiếp theo, không tự commit/push

## 12. Tiến độ

- [x] Phase 0 — Core building blocks
- [x] Phase 1 — Pilot module `request`
- [x] Phase 1.5 — Migrate sang TypeScript (`core/` + `modules/request/` — phạm vi pilot đã định; module
      sau này viết `.ts` ngay từ đầu khi tới lượt, không còn "phase TS riêng")
- [x] Phase 1.7 — Dọn nợ kỹ thuật WorkDayStatus, phần 1.7.1 — xem mục 9 (1.7.2/1.7.3 superseded, gộp
      vào Phase 1.8)
- [ ] Phase 1.8 — Triển khai kiến trúc dài hạn Timesheet/Leave/Attendance — xem mục 13-14. Đã xong
      1.8.1 (shared-kernel) / 1.8.2 (modules/leave) / 1.8.3 (modules/timesheet) / 1.8.4
      (modules/attendance) / 1.8.5 (workflows/ record-check-in/out + import-attendance) — đang tới 1.8.6
      (review-request/cancel-request workflow + cutover modules/request/)
- [ ] Phase 2 — `internal-file`
- [ ] Phase 3 — `user`
- [ ] Phase 4 — `department`
- [ ] Phase 5 — `weekly-report`
- [ ] Phase 6 — `chat` (quyết định phạm vi + migrate)
- [ ] Phase 7 — `post`, `labor-contract`
- [ ] Phase 8 — `attendance`

## 13. Định hướng kiến trúc dài hạn — bounded context Request/Attendance/Timesheet/Leave

**Vị trí của mục này trong tài liệu:** đây **KHÔNG phải 1 phase** trong chuỗi migrate tuần tự (mục 6-10)
— không có task nào ở đây làm ngay bây giờ. Đây là **target design** cho đợt refactor lớn sắp tới (theo
yêu cầu người dùng: "đề xuất chuẩn nhất, không cần quan tâm kiến trúc codebase cũ, vì sắp refactor lại
hết"). Phase 1.7 (mục 9) vẫn tiếp tục làm đúng phạm vi thu hẹp đã chốt trong codebase HIỆN TẠI — không
bị ảnh hưởng bởi mục này. Mục này ghi lại **để tham chiếu khi đợt refactor lớn bắt đầu**, tránh phải bàn
lại từ đầu.

### Insight cốt lõi: quan hệ 2 chiều Request↔Attendance là triệu chứng của 1 context bị thiếu

Toàn bộ khó khăn ở Phase 1.7 (mục 9) tới từ việc coi đây là bài toán "2 module phụ thuộc lẫn nhau".
Thực ra cả Request lẫn Attendance đều **không sở hữu** cái chúng đang tranh nhau ghi: bản ghi ngày công
đã đối soát (`WorkDayStatus`/work_unit). Đây là 1 **derived/reconciled record** dựng từ nhiều nguồn sự
thật (chấm công thật, đơn đã duyệt, chính sách ca/lễ/phạt) — cần 1 context thứ 3 sở hữu việc đối soát
này. Khi tách được, quan hệ 2 chiều biến mất — cả 2 chỉ còn là nguồn cấp sự thật 1 chiều cho context
thứ 3.

### Sai lầm đã mắc phải lúc đầu — và cách sửa: Bounded Context ≠ 1 model = 1 context

Lần đầu đề xuất, đã mắc lỗi kinh điển: map cơ học mỗi Mongoose model thành 1 bounded context riêng
(kể cả `Shift`/`Holiday`/`PenaltyPolicy` — dữ liệu cấu hình gần như CRUD thuần). Người dùng tự phát
hiện ra ("giờ mỗi model có một context là một model riêng hả") — đúng, đây là sai lầm.

**Tiêu chí đúng để xác định 1 bounded context** (áp dụng đúng quy tắc "ai thực sự tiêu thụ" đã dùng ở
mục 3/5 khi quyết định vị trí `getApprovalChain`/`LeaveBalance` trong migration hiện tại):
1. Có hành vi/invariant riêng không (hay chỉ CRUD thuần)?
2. Có ngôn ngữ nghiệp vụ riêng không (từ trong context này nghĩa khác context kia)?
3. Có bị tiêu thụ độc lập bởi ≥2 phía không liên quan không (verify bằng grep, không suy đoán)?
4. Có thay đổi vì lý do khác, tốc độ khác với hàng xóm không?

**Bằng chứng ngay trong hệ thống hiện tại rằng "1 model ≠ 1 context":** `RequestEntity` là 1 aggregate
xử lý **7 discriminator model khác nhau** (leave/late_early/remote/...) — không ai coi đó là 7 context
vì cùng chia sẻ vòng đời/ngôn ngữ. Ngược lại `WorkSheet` và `WorkDayStatus` là 2 collection khác nhau
nhưng nên gộp **cùng 1 context** (Timesheet) — vì cùng 1 câu chuyện (fact thô → status đối soát).

**Áp lại 4 tiêu chí, kết quả: 4 bounded context thật, không phải 7:**

| Context | Hành vi/invariant riêng? | Ngôn ngữ riêng? | ≥2 consumer độc lập? | Kết luận |
|---|---|---|---|---|
| Request | ✅ workflow duyệt, chuỗi phê duyệt | ✅ | — | **Context thật** |
| Attendance | ✅ ghi nhận sự thật vật lý, actor riêng (nhân viên bấm nút / máy chấm công) | ✅ | — | **Context thật** (nhỏ) |
| Timesheet | ✅ engine đối soát, phức tạp nhất | ✅ | — | **Context thật** |
| Leave | ✅ invariant không-âm | ✅ | ✅ (Request + User + 2 cron — đã verify grep) | **Context thật** (nhỏ) |
| ~~Shift~~ | ❌ CRUD thuần | ❌ | — | **KHÔNG phải context** |
| ~~Holiday~~ | ❌ CRUD thuần | ❌ | — | **KHÔNG phải context** |
| ~~PenaltyPolicy~~ | ❌ bảng tra cứu ngưỡng | ❌ | — | **KHÔNG phải context** |

`Shift`/`Holiday`/`PenaltyPolicy` là **Generic Subdomain** (thuật ngữ DDD — dữ liệu cấu hình/tham
chiếu, không ngôn ngữ nghiệp vụ riêng) — chỉ nên là repository đơn giản, KHÔNG có domain/application
riêng, đặt trong `modules/timesheet/infrastructure/reference-data/` (Timesheet là consumer chính) thay
vì làm module ngang hàng.

### Context map — đồ thị phụ thuộc phi chu trình (acyclic)

```
Request     ──(RequestApproved / RequestCancelled)──▶  Timesheet
Attendance  ──(PunchRecorded / DayImported)─────────▶  Timesheet
Timesheet   ──(RefundLeave / DeductLeave)───────────▶  Leave
Timesheet   ◀──(đọc reference-data)── Shift, Holiday, PenaltyPolicy
```

Request và Attendance **không bao giờ tham chiếu lẫn nhau nữa** — khác hẳn hiện trạng
(`attendanceHelper.js require leaveHandler.js` và ngược lại). Cả 2 chỉ nói chuyện với Timesheet
(upstream → downstream). Quan hệ theo context-mapping: **Customer/Supplier + Published Language**.

**Nguyên tắc "1 owner cho WorkDayStatus":** chỉ Timesheet được ghi `WorkDayStatus`/work_unit. Request
và Attendance yêu cầu Timesheet tính lại, không tự ghi trực tiếp — diệt tận gốc loại bug "2 đường code
độc lập, mỗi bên 1 bản sao luật, mâu thuẫn nhau" đã phát hiện ở Phase 1.7.

### Quyết định consistency model: Hướng B (orchestration đồng bộ, 1 transaction)

Đã cân nhắc 2 hướng chuẩn:
- **Hướng A (event-driven, eventual consistency):** mỗi context commit riêng, publish domain event,
  Timesheet đối soát bất đồng bộ. Ranh giới sạch nhất, scale độc lập, nhưng cần outbox pattern + chịu
  cửa sổ eventual + saga cho hoàn phép khi refund fail.
- **Hướng B (orchestration đồng bộ, 1 transaction):** 1 use-case service điều phối cả Request +
  Timesheet + Leave trong 1 transaction MongoDB. Nhất quán mạnh, đơn giản, "duyệt xong bảng công đúng
  ngay". Transaction bị buộc vào nhiều context — chỉ khả thi vì cùng 1 MongoDB.

**Đã chọn Hướng B** (người dùng xác nhận) — lý do: 1 hệ, 1 MongoDB, 1 deployable; nghiệp vụ thật muốn
nhất quán ngay; ACID transaction đơn-DB đã chứng minh chạy đúng (verify thật ở task 1.10/1.12). Giao
tiếp giữa các context vẫn qua command/event object có schema rõ (Published Language) để sau này **có
thể** chuyển sang Hướng A mà không phải viết lại domain, chỉ đổi orchestrator.

**Lưu ý quan trọng — đừng dùng event cho điều phối đồng bộ:** trong Hướng B, workflow **gọi tường
minh** từng bước (`timesheet.reconcileForDecision(...)`), KHÔNG để Timesheet "subscribe" event
`RequestApproved` rồi chạy đồng bộ ngầm — event dùng để tách rời qua ranh giới thời gian (async), dùng
event mà chạy đồng bộ thì mất cả 2 lợi ích (control flow bị giấu, không decouple thật). Event trong
Hướng B chỉ giữ vai trò: (a) side-effect async thật (thông báo — đã làm đúng ở task 1.14), (b) đường
thoát sang Hướng A sau này.

### Invariant khó nhất: hoàn phép khi chấm công đè lên ngày nghỉ

Ca xương nhất (`resolveLeaveConflictOnAttendance` hiện tại): người có phép đã duyệt nhưng vẫn đi làm
đủ giờ → phải hoàn phép. Trong target: Attendance ghi punch → Timesheet đối soát → phát hiện
`leave_paid` bị `present` đè → Timesheet phát command `RefundLeave` cho Leave. Policy "chấm công phủ
đủ buổi thì hoàn" thuộc Timesheet (luật đối soát); thực thi mutate sổ cái thuộc Leave. Hướng B: cùng
transaction → nguyên tử, không cần saga/compensation.

### Cấu trúc thư mục target

```
src/
  shared-kernel/                 # value object dùng chung — HẸP, không entity/model
    employee-id.ts  date-key.ts  period.ts  money.ts

  core/                          # building block hiện có — Entity/AggregateRoot/Repo base/context/http

  modules/                       # mỗi bounded context 1 hexagon KHÉP KÍN — 4 context thật
    request/        domain/ application/ infrastructure/ interface/ index.ts
    attendance/      domain/ application/ infrastructure/ index.ts
    timesheet/       domain/ (work-day.entity.ts, policies/resolve-work-day.ts,
                     policies/leave-attendance-conflict.ts)
                     application/ (reconcile-for-punch, reconcile-for-decision)
                     infrastructure/ (timesheet.repository.ts + reference-data/ cho
                     Shift/Holiday/PenaltyPolicy — repository đơn giản, không có domain riêng)
                     index.ts
    leave/           domain/ application/ infrastructure/ index.ts

  workflows/                     # ★ TẦNG ORCHESTRATION — nơi DUY NHẤT được import ≥2 module
    review-request.workflow.ts    # request.approve + timesheet.reconcileForDecision + leave.deduct
    cancel-request.workflow.ts
    record-checkout.workflow.ts   # attendance.checkOut + timesheet.reconcileForPunch
    import-attendance.workflow.ts

  composition-root/
    routes.ts                     # /requests/:id/review → review-request.workflow
                                   # /requests (list) → request.application (thuần, không cần workflow)
```

### 4 luật giữ cho kiến trúc không sụp (quan trọng hơn cây thư mục)

| # | Luật | Vì sao |
|---|---|---|
| 1 | `modules/x` chỉ import `core/`, `shared-kernel/`, và chính nó — KHÔNG import `modules/y` | Diệt phụ thuộc chéo/vòng tận gốc (đúng lỗi `attendanceHelper ↔ leaveHandler` hiện tại) |
| 2 | `workflows/` là nơi DUY NHẤT import nhiều module, và chỉ qua `index.ts` (public API) — không thò vào `domain/`/`infrastructure/` module khác | Module đổi nội bộ không vỡ workflow |
| 3 | Mỗi Mongoose model có đúng 1 owner = repository của 1 module | Đây chính là "1 owner cho WorkDayStatus" |
| 4 | Transaction xuyên context: workflow mở `runInTransaction`, session chảy qua `AsyncLocalStorage` → mọi repository tự nhặt → 1 transaction | Cơ chế **đã xây sẵn từ Phase 0** (`RequestContextService`) — Hướng B tận dụng nguyên vẹn, không cần gì mới |

**Trạng thái:** định hướng kiến trúc đã thống nhất — **đã bắt đầu triển khai**, xem mục 14 (Phase 1.8).

## 14. Phase 1.8 — Triển khai kiến trúc dài hạn (Timesheet/Leave/Attendance)

**Quyết định phạm vi (người dùng xác nhận):** task 1.7.2 (di dời `resolveLeaveConflictOnAttendance`)
KHÔNG làm riêng như 1 bản vá tạm trong cấu trúc `helpers/` cũ nữa — gộp hẳn vào việc xây
`modules/timesheet/` đúng 1 lần theo kiến trúc mục 13. Task 1.7.3 (tách Excel-parsing) tương tự, rơi
tự nhiên vào lúc xây `modules/attendance/infrastructure/`.

**Thứ tự triển khai (theo dependency — xây nền trước, xây phía tiêu thụ sau):**

```
1.8.1 shared-kernel/     (không phụ thuộc gì)
1.8.2 modules/leave/     (phụ thuộc shared-kernel — context nhỏ nhất, logic đã đúng sẵn ở
                          helpers/leaveBalance.js, chỉ cần bọc DDD, rủi ro thấp)
1.8.3 modules/timesheet/ (phụ thuộc shared-kernel + leave — phần khó nhất, giá trị lớn nhất,
                          absorb nguyên task 1.7.2)
1.8.4 modules/attendance/ (phụ thuộc timesheet — absorb task 1.7.3)
1.8.5 workflows/         (phụ thuộc cả 4 module qua public API index.ts)
1.8.6 Cutover modules/request/ + 7 handler trong helpers/ (đổi để gọi qua workflows/ thay vì tự ghi)
1.8.7 Xoá code cũ đã port xong (attendanceHelper.ts, phần Attendance-side của leaveHandler.js/
      awayDayHandler.js, phần liên quan trong AttendanceController.js)
1.8.8 Cập nhật CLAUDE.md + tổng kết
```

Theo đúng nguyên tắc đã dùng cho Phase 2+ (mục 10) — **chỉ chi tiết hoá phần làm ngay** (1.8.1, 1.8.2),
các phần sau chi tiết hoá khi tới lượt, tránh lập kế hoạch cho thứ có thể đổi sau khi rút kinh nghiệm.

### 1.8.1 — `shared-kernel/` (chi tiết đầy đủ, làm ngay)

Value object thuần, không phụ thuộc gì, rủi ro thấp nhất trong toàn Phase 1.8:

- [x] 1.8.1.1 — `src/shared-kernel/employee-id.ts`: value object bọc `string`/`ObjectId` (`of()` tự
      `String()` hoá), `equals()`, `toString()`. 6 test (`__tests__/shared-kernel/employee-id.test.ts`).

      **Bug thật phát hiện qua review của người dùng:** bản đầu `of(value)` gọi `String(value)` TRƯỚC
      khi kiểm tra null/undefined — `String(null) === "null"`, `String(undefined) === "undefined"`,
      cả 2 đều là chuỗi khác rỗng nên lọt qua `validate()` (chỉ check `!value` — chuỗi "null" không
      falsy). Verify thật: `EmployeeId.of(null)` tạo ra 1 `EmployeeId("null")` "hợp lệ" thay vì throw.
      Hậu quả thực tế: chỗ nào gọi `EmployeeId.of(record.employeeId)` mà field bị thiếu (query sai,
      join lệch, MongoDB trả `null`) sẽ không fail ngay tại nguồn — bug trôi xuống tận lúc query/so
      sánh sai mới lộ, mất dấu vết chỗ tạo ra nó. **Fix:** check `value === null || value === undefined`
      và throw `ArgumentInvalidException` TRƯỚC khi gọi `String()` — input hợp lệ (kể cả object có
      `.toString()` như Mongoose ObjectId) không bị ảnh hưởng. Verify lại: `npm test` 379/17 (tăng đúng
      1 test), không regression.
- [x] 1.8.1.2 — `src/shared-kernel/date-key.ts`: value object `"YYYY-MM-DD"` + `from(date)` (thay
      `moment.tz(x, TZ).format("YYYY-MM-DD")` lặp lại ở `attendanceHelper.ts`, `finalizeWorkDay.js`,
      `leaveHandler.js`...) + `toDate()`. 6 test, verify timezone thật (không suy đoán):
      `2026-01-05T20:00:00Z` (UTC) → đúng `"2026-01-06"` giờ VN (+7).

      **Bug thiết kế phát hiện qua review của người dùng (bản đầu `from(date, timezone)`/
      `toDate(timezone)` nhận tz làm tham số):** nếu người gọi lỡ truyền tz khác nhau giữa lúc `from()`
      và lúc `toDate()`, cùng 1 `DateKey` sẽ âm thầm đại diện cho 2 instant khác nhau (`"2026-08-02
      00:00 Tokyo"` ≠ `"2026-08-02 00:00 Ho Chi Minh"`) mà không có cảnh báo gì — lỗi tiềm ẩn, chưa bị
      kích hoạt nhưng có thật trong API. Verify bằng grep toàn repo (không suy đoán): **22 file khác
      nhau đều hardcode y hệt `const TZ = "Asia/Ho_Chi_Minh"`** — hệ thống chỉ có đúng 1 timezone thật.
      **Fix:** bỏ hẳn tham số `timezone` khỏi `from()`/`toDate()`, `DateKey` tự sở hữu hằng số
      `APP_TIMEZONE = "Asia/Ho_Chi_Minh"` nội bộ — loại bỏ hoàn toàn khả năng truyền lệch giữa 2 lời
      gọi. Nếu tương lai thật sự cần đa timezone (import chấm công từ vùng khác), đó là quyết định lớn
      hơn cần làm tường minh ở nơi gọi, không nên ẩn trong tham số mặc định của 1 value object dùng
      chung. Cập nhật lại 6 test khớp API mới, verify lại toàn bộ `npm test` 378/17 không đổi.
- [x] 1.8.1.3 — `src/shared-kernel/period.ts`: type `"morning"|"afternoon"|"full"` + `includesMorning()`/
      `includesAfternoon()` + `isCoveredBy(coversMorning, coversAfternoon)` (đặt tên rõ cho luật
      `shouldOverride` hiện viết tay ở `resolveLeaveConflictOnAttendance`, `leaveHandler.js`). 14 test —
      bảng chân trị `it.each` verify khớp CHÍNH XÁC 9 tổ hợp của luật gốc.

      **Code smell phát hiện qua review của người dùng:** bản đầu `of(value: string)` dùng
      `value as PeriodValue` — type assertion mù, compiler tin theo mà không tự kiểm chứng. Không sai
      hành vi runtime (`validate()` trong `ValueObject` base constructor vẫn chặn được giá trị lạ),
      nhưng là lớp an toàn compile-time giả: nếu sau này ai refactor bỏ lời gọi `validate()` khỏi
      constructor của `ValueObject` base, TypeScript sẽ không báo lỗi gì vì đã bị đánh lừa từ trước bởi
      `as`. **Fix:** thay bằng type guard thật (`function isPeriodValue(value): value is PeriodValue`)
      + assertion function (`function assertValidPeriod(value): asserts value is PeriodValue`) — `of()`
      tự verify runtime trước, TypeScript tự narrow kiểu sau khi qua assertion, không còn `as` nào.
      Không đổi hành vi (vẫn 14 test cũ pass nguyên vẹn), chỉ nâng mức an toàn compile-time — 2 điểm
      enforcement độc lập (`of()` lẫn `validate()`) cùng dùng chung 1 type guard, không phụ thuộc vào
      đúng 1 chỗ duy nhất. `npm test` toàn repo: 382/17 (verify lại bằng `--runInBand` vì 1 lần chạy
      song song trước đó cho 21 fail do test khác flaky, không liên quan — chạy lại xác nhận đúng
      382/17).
- [x] 1.8.1.4 — `src/shared-kernel/money.ts`: value object cho số ngày phép/tiền phạt (hiện là `number`
      trần trụi ở `LeaveBalanceModel.amount`, `WorkSheetModel.penalty_amount`) — `add()`/`subtract()`/
      `isNegative()`/`zero()`. 9 test, verify riêng `zero()` không bị `isEmpty()` của `ValueObject` base
      chặn nhầm (0 khác falsy trong check `value === null/undefined/""`).

      **Bug thật phát hiện qua review của người dùng:** bản đầu `add()`/`subtract()` cộng/trừ `number`
      JS thuần, dính lỗi floating point kinh điển (`0.1 + 0.2 !== 0.3`). Verify liên quan trong chính
      codebase (không suy đoán): `kpiDecompose.js` đã có sẵn `round2()` (`Math.round(n*100)/100`),
      `commissionCalculator.js` đã tự `Math.round()` mọi giá trị output — xác nhận đây là vấn đề **đã
      biết và đã có quy ước xử lý** trong hệ thống, không phải lý thuyết suông. Nếu `Money` dùng cho
      tính lương/hoa hồng/KPI sau này mà không xử lý, sai số nhỏ tích luỹ qua nhiều phép tính liên tiếp
      sẽ lệch số liệu báo cáo thật, khó phát hiện qua test thường vì lệch rất nhỏ.

      **Fix:** làm tròn về 2 chữ số thập phân (`Math.round(value*100)/100`) ngay khi `of()` VÀ sau MỖI
      lần `add()`/`subtract()` (không chỉ ở kết quả cuối) — đúng quy ước có sẵn (`round2()` của
      `kpiDecompose.js`), không thêm thư viện `decimal.js`/`big.js` (không cần độ chính xác tuỳ ý, VND
      không có phần thập phân thực). Verify thật bằng script (không suy đoán): `0.1+0.2` qua `Money`
      cho đúng `0.3`; chuỗi 20 lần `.add(Money.of(0.1))` liên tiếp cho đúng `2.1` (không có
      `2.1000000000000005` như phép cộng JS thuần) — xác nhận round sau MỖI bước triệt tiêu hoàn toàn
      tích luỹ sai số, vì nhiễu float của 1 phép tính đơn luôn nhỏ hơn nhiều so với lưới làm tròn 0.01.
      Thêm 3 test case, `npm test` toàn repo 382/17 (tăng đúng 3), không regression.

**Definition of done 1.8.1 — ĐÃ ĐẠT:** 4 value object thuần (31 test, không cần DB), chưa ai require
(chưa cutover, task này chỉ tạo nền, không đổi hành vi gì). `npm test` toàn repo: 378 pass / 17 fail
(tăng đúng 31 test mới, 4 suite pre-existing không đổi). `npm run build` + `npm run lint` (4266, không
đổi) đều sạch.

### 1.8.2 — `modules/leave/` (chi tiết đầy đủ, làm tiếp theo 1.8.1)

**Câu hỏi người dùng nêu lại (đáng ghi rõ, dễ nhầm lẫn):** "leave" không nằm trong Request à? — cần
phân biệt 2 thứ khác nhau đang trùng tên "leave":

1. **"leave" — 1 trong 7 loại đơn của `RequestEntity`** (cùng loại với late_early/remote/
   business_trip...) — **vẫn thuộc `modules/request/`**, không đổi gì. Workflow duyệt/từ chối/huỷ của
   đơn nghỉ phép vẫn là Request lo.
2. **`LeaveBalance` — sổ cái số ngày phép còn lại** (`helpers/leaveBalance.js`, sắp thành
   `modules/leave/`) — đây mới là cái tách ra ở đây.

Lý do tách #2 khỏi Request: áp đúng quy tắc "vị trí quyết định bởi ai thực sự tiêu thụ" (mục 3/5).
Grep thật xác nhận `adjustLeaveBalance`/`getLeaveBalance` có **4 consumer độc lập, không liên quan
nhau** (đã sửa lại 2 lần: từ "4" ban đầu xuống "3" — loại `jobs/accrueMonthlyLeave.js` vì KHÔNG thực
sự dùng module này, tự `insertMany` trực tiếp — rồi phát hiện thêm 1 consumer đọc-thuần bị bỏ sót khi
chỉ grep theo `adjustLeaveBalance`, nâng lại lên đúng "4"):
- `helpers/leaveHandler.js` — Request (khi tạo/duyệt/huỷ đơn nghỉ phép, trừ/hoàn ngày). Ghi (qua
  `adjustLeaveBalance`) + đọc (`getLeaveBalance`, dùng để tính `total_days` khi tạo đơn).
- `jobs/autoRejectLeaveRequests.js` — cron tự động, không qua workflow duyệt của ai. Chỉ ghi.
- `controllers/UserController.js` — **HR chỉnh tay số ngày phép của nhân viên từ trang hồ sơ**, hoàn
  toàn không liên quan gì tới việc có đơn nào được tạo/duyệt hay không. Ghi + đọc (hiển thị lại số dư
  sau khi chỉnh).
- `controllers/AttendanceController.js` — **phát hiện thêm ở task 1.8.2.5**, bị bỏ sót khi đếm "3" vì
  chỉ grep `adjustLeaveBalance` (nhánh ghi) mà không grep riêng `getLeaveBalance`. Chỉ ĐỌC (2 chỗ:
  hiển thị số dư hiện tại + số dư dự phóng theo tháng ở trang chấm công/hồ sơ nhân viên), không ghi,
  không cần lock.

Điểm thứ 3 là bằng chứng quyết định: sổ cái phép có thể bị chỉnh sửa **không thông qua bất kỳ Request
nào** — nghĩa là không phải "1 phần phụ thuộc của Request" mà là 1 khái niệm độc lập (ledger) mà Request
chỉ là 1 trong nhiều bên tác động vào, giống hệt User (qua `UserController`) và cron. Nếu nhét
`LeaveBalance` vào `modules/request/domain/`, `UserController` (thuộc User context) sẽ phải "thò tay"
vào domain của Request để chỉnh phép — vi phạm luật #1 đã chốt ở kiến trúc dài hạn (mục 13). So sánh
ngược lại: `getApprovalChain`/`resolveReviewerProfileByAccountId` (task 1.9b) grep ra **chỉ Request
dùng** nên đúng là chuyển vào `modules/request/domain/` — `LeaveBalance` grep ra ngược lại nên đúng là
tách riêng.

Context nhỏ nhất, logic hiện tại (`helpers/leaveBalance.js`) đã đúng (Redis lock, invariant không-âm)
— chỉ cần bọc lại đúng khuôn DDD, KHÔNG đổi logic nghiệp vụ:

- [x] 1.8.2.1 — Characterization test — **đã có sẵn**, không cần viết mới:
      `__tests__/leaveBalance.test.js` cover đầy đủ SUM đúng, `isDeleted` filter, cô lập theo user,
      chặn âm, `allowNegative`, guard amount/reason, `balance_after` snapshot semantics, và cả **race
      test thật** (2 lệnh đồng thời, xác nhận Redis lock hoạt động đúng). Dùng làm lưới an toàn cho các
      task sau.
- [x] 1.8.2.2a — `modules/leave/domain/leave-balance.errors.ts`: `InsufficientLeaveBalanceError`
      (`extends ArgumentInvalidException`, 400 — invariant thật, khác input validation thuần) +
      `LeaveLockTimeoutError` (`extends ConflictException`, 409). Verify thật: `code`/`statusCode` khớp
      đúng `LeaveBalanceError` cũ (400/409).
- [x] 1.8.2.2b — `modules/leave/domain/leave-balance.entity.ts`: model hoá invariant hiện có (không âm
      trừ khi `allowNegative`) thành Entity (định danh bởi `EmployeeId` — không có 1 document duy nhất
      cho mỗi nhân viên trong DB, `amount` là kết quả `$sum` từ nhiều dòng ledger, nên Entity ở đây là
      "trạng thái đã reconstitute", không phải load-1-document-rồi-save"), dùng `Money`
      (`shared-kernel/money.ts`) cho `amount`. `applyAdjustment(delta, allowNegative)` chỉ tính +
      kiểm tra invariant, KHÔNG tự ghi DB (application service ở 1.8.2.4 chịu trách nhiệm ghi ledger).
      Verify thật (script chạy qua `ts-node/register/transpile-only`): `reconstitute(EmployeeId.of(
      'emp-1'), Money.of(2)).applyAdjustment(Money.of(-5), true)` → `-3` (khớp test gốc "allowNegative:
      true — thành công, balance âm đúng như kỳ vọng"); `applyAdjustment(Money.of(-5), false)` → throw
      `InsufficientLeaveBalanceError` statusCode 400 (khớp test gốc "chặn âm mặc định — throw");
      `balance.id === "emp-1"` xác nhận `EmployeeId` được dùng đúng làm identity. `tsc --noEmit` +
      `eslint` sạch. Full suite `npx jest --runInBand`: ổn định `382 passed / 17 failed` (đúng 4 suite
      lỗi cũ đã biết: `requestApprovalFlow`, `forgotCheckinApprove`, `approvalChain`,
      `attendanceMerge`) — không giảm, không có suite mới fail. (1 lần chạy đầu ra `23 failed/376
      passed` bất thường, chạy lại ngay lập tức cho kết quả ổn định như trên → xác nhận flaky/transient
      của môi trường chạy test, không phải regression do file mới.)

      **Bug thật phát hiện qua review của người dùng (vòng 2):** bản đầu `applyAdjustment()` tính
      `newBalance` và kiểm tra invariant nhưng chỉ `return newBalance` — KHÔNG mutate `this.props.amount`.
      Trái với chính quy ước đã có sẵn trong module `request` (`RequestEntity` dùng `this._setProps(...)`
      sau mỗi hành vi nghiệp vụ để repository/mapper đọc lại qua `getProps()`) — 1 method có tên mang ý
      nghĩa mệnh lệnh ("apply") mà không mutate state là gây hiểu lầm ngược, caller có thể tưởng entity
      đã đổi nhưng `leaveBalance.amount` vẫn là giá trị cũ.

      **Fix:** thêm `this._setProps({ amount: newBalance.toNumber() })` ngay sau khi invariant check qua
      (trước khi return) — throw vẫn xảy ra TRƯỚC `_setProps` nên state giữ nguyên nếu vi phạm invariant
      (đã verify: gọi `applyAdjustment` với case throw xong, `amount` không đổi). Method vẫn trả về
      `Money` mới để application service dùng ghi `balance_after` vào dòng ledger mà không cần tính lại
      — entity không tự ghi DB, chỉ mutate in-memory state của chính nó. Verify thật bằng script: gọi
      `applyAdjustment(Money.of(-5), true)` trên balance ban đầu 2 → cả giá trị trả về VÀ
      `entity.amount.toNumber()` sau đó đều là `-3`; gọi case throw (`allowNegative: false`) xong,
      `entity.amount.toNumber()` vẫn giữ nguyên `2` (không bị mutate một phần). `tsc`/`eslint` sạch,
      full suite lại `382 passed / 17 failed`, không regression.
- [x] 1.8.2.3 — `modules/leave/infrastructure/leave-balance.repository.ts`: bọc `LeaveBalanceModel` —
      nơi DUY NHẤT được require model này sau khi cutover xong (1.8.2.6/1.8.2.7). `LeaveBalanceRepository`
      có 2 method: `getBalance(employeeId, session?)` (port nguyên `getLeaveBalance` — aggregate `$sum`
      filter `isDeleted: false`, trả về `LeaveBalance.reconstitute(...)`) và
      `appendLedgerEntry(entry, session?)` (port phần insert ledger row của `adjustLeaveBalance`, nhận
      `balanceAfter: Money` để ghi `balance_after`).

      **Quyết định thiết kế đáng chú ý — session:** không chỉ đọc session qua
      `RequestContextService.getTransactionSession()` (khác `MongooseRepositoryBase` của `request`).
      Lý do: grep xác nhận 2/3 consumer GHI (`jobs/autoRejectLeaveRequests.js`,
      `controllers/UserController.js` — chưa tính `controllers/AttendanceController.js`, consumer đọc-
      thuần phát hiện sau ở 1.8.2.5, không cần session) tự tạo session bằng `mongoose.startSession()`
      trực tiếp, KHÔNG chạy trong `RequestContextService.runChild` — chỉ `leaveHandler.js` mới nằm
      trong context đó (được gọi từ trong `runInTransaction` của `review-request.service.ts`, đã verify
      qua đọc `review-request.service.ts:108-110`). Nếu repository chỉ dựa AsyncLocalStorage, 2 consumer
      ghi kia sẽ
      mất transaction một cách âm thầm ngay khi cutover (1.8.2.6) — nên mỗi method nhận `session?` tường
      minh (giữ đúng signature gốc của `helpers/leaveBalance.js`), chỉ fallback
      `RequestContextService` khi caller không truyền vào.

      Verify thật bằng script với `MongoMemoryServer` (không cần replset vì chưa test transaction thật
      ở bước này, chỉ verify persistence logic): balance rỗng = 0; 2 ledger entry (+12, -3) của 1 nhân
      viên → balance = 9; ledger của nhân viên khác không lẫn vào; soft-delete 1 dòng → bị loại khỏi
      `$sum` đúng như `isDeleted: false` filter gốc; các field ghi vào document (`ref_id`/`ref_type`
      default `null`, `note` default `""`, `created_by` default `null`, `balance_after` đúng giá trị)
      khớp chính xác. `tsc --noEmit` + `eslint` sạch. Full suite ổn định `382/17` (1 lần chạy ra
      `381/18` do `kpiDailyReport.test.js` — không liên quan gì đến leave module — chạy lại ngay cho
      kết quả ổn định → xác nhận flaky, không phải regression).

      **Race condition thật phát hiện qua review của người dùng:** `getBalance()` và
      `appendLedgerEntry()` là 2 lời gọi rời nhau, không có gì khoá giữa chừng. Người dùng đặt đúng câu
      hỏi: bọc cả 2 trong 1 Mongo transaction có tự đủ để chặn 2 giao dịch trừ phép đồng thời cho cùng 1
      nhân viên hay không (kịch bản thật: 2 manager duyệt 2 đơn khác nhau cho cùng nhân viên gần như
      cùng lúc)?

      **Verify thật bằng `MongoMemoryReplSet`** (không suy đoán): chạy N=15 lần, mỗi lần 2 transaction
      Mongo đồng thời cùng `getBalance → applyAdjustment(-4, allowNegative:false) → appendLedgerEntry`
      cho 1 nhân viên có balance ban đầu = 5. Kết quả: **14/15 lần cả 2 transaction đều commit thành
      công VÀ balance cuối cùng bị âm** (5-4-4=-3), dù mỗi transaction riêng lẻ đều check invariant
      "không âm" đúng. Nguyên nhân: Mongo snapshot isolation không phát hiện conflict vì 2 transaction
      insert 2 document ledger KHÁC NHAU (không cùng ghi 1 document) — đây là write skew kinh điển,
      không phải lý thuyết suông.

      (Lưu ý phụ: lần thử đầu có chèn `setTimeout` giả tạo giữa đọc/ghi để dàn thời gian ra quan sát —
      vô tình khiến 2 transaction chậm lại đủ để đụng collection-level lock timeout 5ms của Mongo
      [`maxTransactionLockRequestTimeoutMillis`, mặc định 5ms kể cả production] và 1 bên bị lỗi ngẫu
      nhiên, tạo cảm giác sai là "Mongo tự chặn được". Chạy lại KHÔNG delay giả tạo — đúng luồng thật sẽ
      chạy — mới lộ ra corruption thật ở tỷ lệ 14/15. Bài học: phải verify với timing tự nhiên, không
      chèn delay nhân tạo làm sai lệch kết luận.)

      **Kết luận — không sửa gì ở Repository (đúng, việc khoá không thuộc trách nhiệm tầng persistence):**
      thêm comment cảnh báo ở đầu class `LeaveBalanceRepository` (2 method này không an toàn nếu gọi rời
      nhau, phải nằm trong lock của application service) để tránh future contributor gọi trực tiếp.
      Việc khoá giữ nguyên đúng thiết kế gốc — chuyển sang task 1.8.2.4.
- [x] 1.8.2.4 — `modules/leave/infrastructure/leave-balance-lock.ts` (`acquireUserLeaveLock`, port
      nguyên từ `helpers/leaveBalance.js` — TTL 5s, budget chờ 10s, retry 50-100ms, giữ nguyên toàn bộ
      tham số, throw `LeaveLockTimeoutError` — đã tạo ở 1.8.2.2a) +
      `modules/leave/application/adjust-leave-balance.service.ts` (port `adjustLeaveBalance`): validate
      `amount`/`reason` TRƯỚC khi acquire lock (giữ đúng thứ tự gốc — không tốn lượt lock cho input
      sai), rồi lock bọc TOÀN BỘ chuỗi `repository.getBalance → entity.applyAdjustment →
      repository.appendLedgerEntry` — đây là cơ chế DUY NHẤT thật sự chặn race condition đã verify ở
      1.8.2.3 (Mongo transaction không tự làm được).

      **Phát hiện thêm khi verify (đáng chú ý cho cutover 1.8.2.6):** 2 nơi gọi `adjustLeaveBalance` cũ
      check lỗi bằng `e instanceof LeaveBalanceError` + đọc `e.status` (`controllers/UserController.js:772`,
      `helpers/leaveHandler.js:159`) — class `LeaveBalanceError` cũ dùng field `.status`, còn
      `ExceptionBase` (nền tảng mới) dùng `.statusCode`. Khi cutover, 2 chỗ này phải đổi sang
      `instanceof ArgumentInvalidException/InsufficientLeaveBalanceError/LeaveLockTimeoutError` (hoặc
      kiểm tra qua `ExceptionBase`) và đọc `.statusCode` thay vì `.status` — nếu không đổi, các nhánh
      catch đặc biệt này sẽ âm thầm rơi vào nhánh `500 Lỗi server` thay vì đúng mã lỗi gốc (400/409).
      Đã note để không bị bỏ sót ở 1.8.2.6.

      Verify thật bằng file test tạm (`MongoMemoryReplSet` + `moduleNameMapper` mock Redis có sẵn của
      Jest, xoá sau khi verify xong, không giữ lại): `amount=0` và `amount=NaN` → throw
      `ArgumentInvalidException` message "Số ngày điều chỉnh không hợp lệ"; `reason` sai → throw cùng
      loại message "Lý do điều chỉnh không hợp lệ"; `allowNegative:false` số dư không đủ → throw
      `InsufficientLeaveBalanceError` (400), xác nhận KHÔNG có dòng ledger nào bị ghi thêm khi throw;
      `allowNegative:true` → thành công, `balance_after` đúng giá trị âm; field `refId`/`refType`/
      `note`/`createdBy` ghi đúng vào ledger. **Race test quan trọng nhất** (lặp lại 5 lần, không lần
      nào flaky): balance ban đầu = 5, 2 lệnh trừ 4 chạy đồng thời cho cùng nhân viên → đúng 1/2 thành
      công (5-4=1), 1/2 bị chặn bởi invariant (1-4<0) — tổng cuối cùng luôn = 1, KHÔNG bao giờ âm. Xác
      nhận lock đã chặn đúng race condition đã phát hiện ở 1.8.2.3. `tsc --noEmit` + `eslint` sạch. Full
      suite ổn định `382/17`, không regression.

      **Sửa theo review của người dùng (lệch convention, không phải bug):** bản đầu
      `acquireUserLeaveLock(userId)` dùng thẳng `userId` thô để tạo lock key, trong khi
      `repository.getBalance(employeeId, ...)` lại dùng `employeeId.toString()` — 2 nguồn khác nhau
      cho cùng 1 giá trị định danh. `EmployeeId.of()` hiện tại chỉ wrap/validate (`String(value)`
      không đổi giá trị) nên chưa gây sai lệch thật, nhưng nếu sau này `EmployeeId` thêm logic chuẩn
      hoá (trim/case...), lock key và balance key có thể lệch nhau. **Fix:** đổi thành
      `acquireUserLeaveLock(employeeId.toString())` — dùng đúng 1 nguồn duy nhất
      (`EmployeeId.toString()`) cho mọi nơi cần định danh nhân viên trong luồng này. `tsc`/`eslint`
      sạch, full suite lại `382/17`.
- [x] 1.8.2.5 — `modules/leave/application/get-leave-balance.service.ts` (port nguyên `getLeaveBalance`
      — đọc thuần, KHÔNG lock vì không có invariant nào cần bảo vệ khi chỉ đọc) +
      `modules/leave/index.ts`: public API — chỉ export 2 application service
      (`adjustLeaveBalance`/`getLeaveBalance`) + 2 error class (`InsufficientLeaveBalanceError`/
      `LeaveLockTimeoutError`, cần thiết để caller `instanceof`-check khi cutover), KHÔNG export
      domain Entity/Repository/Lock (đúng luật #2 ở mục 13).

      **Phát hiện quan trọng khi làm task này:** grep riêng `getLeaveBalance` (không chỉ
      `adjustLeaveBalance`) lộ ra `controllers/AttendanceController.js` cũng gọi trực tiếp
      `helpers/leaveBalance.js` — 2 chỗ đọc thuần (số dư hiện tại + số dư dự phóng theo tháng ở trang
      chấm công/hồ sơ), không qua `adjustLeaveBalance` nên bị bỏ sót ở lần đếm "3 consumer" trước đó.
      Đã sửa lại thành **4 consumer** (xem đính chính đầy đủ ở đầu mục 1.8.2) — task 1.8.2.6 phải cutover
      cả file này.

      Verify thật: file test tạm (`MongoMemoryReplSet`) import qua `modules/leave/index.ts` (không
      phải qua đường dẫn file trong module) — `adjustLeaveBalance` rồi `getLeaveBalance` phản ánh đúng
      số dư mới (12-3=9); nhân viên chưa có ledger → `getLeaveBalance` trả về 0 (khớp hành vi gốc, `row
      ? row.total : 0`). **Verify encapsulation** bằng `@ts-expect-error` cố tình import
      `LeaveBalanceRepository` từ `modules/leave` — biên dịch báo lỗi đúng như kỳ vọng (nếu lỡ export
      nhầm, `@ts-expect-error` sẽ tự báo "unused directive" — không xảy ra, xác nhận đúng bị chặn).
      `tsc --noEmit` + `eslint` sạch. Full suite ổn định `382/17` (1 lần chạy ra `381/18` do
      `kpiDailyReport.test.js` — flaky đã biết, không liên quan).
- [x] 1.8.2.6 — Cutover 4 consumer thật sang gọi `modules/leave/index.ts` thay vì
      `helpers/leaveBalance.js` trực tiếp.

      **Quyết định phạm vi (hỏi người dùng trước khi làm, vì đụng chạm quy tắc "file nào sửa cũng
      chuyển TS" đã chốt):** 2 trong 4 consumer là controller khổng lồ, đa mục đích
      (`UserController.js` 1122 dòng, `AttendanceController.js` 1566 dòng) — convert toàn bộ sang TS
      chỉ để đổi 1 dòng require sẽ làm phình phạm vi task này rất nhiều và rủi ro không cần thiết
      (hàng chục route không liên quan gì đến leave). Người dùng chọn: **giữ nguyên `.js` cho cả 4
      file, chỉ sửa tối thiểu dòng require + nhánh `instanceof` liên quan đến leave balance.** Việc
      convert toàn bộ 2 controller lớn sang TS để dành cho phase phù hợp hơn (vd khi migrate module
      `user`/`attendance`).

      **Thay đổi cụ thể từng file:**
      - `helpers/leaveHandler.js`: đổi require `./leaveBalance` → `../modules/leave` (lấy
        `getLeaveBalance`, `adjustLeaveBalance`, `LeaveLockTimeoutError`) + `../core/exceptions/exceptions`
        (`ArgumentInvalidException`). Nhánh catch ở `onCreate()`: đổi
        `e instanceof LeaveBalanceError ? e.status : 500` →
        `(e instanceof ArgumentInvalidException || e instanceof LeaveLockTimeoutError) ? e.statusCode : 500`
        (`ArgumentInvalidException` cover cả `InsufficientLeaveBalanceError` vì là class con, không cần
        import riêng).
      - `jobs/autoRejectLeaveRequests.js`: chỉ đổi require, không có nhánh `instanceof` nào (catch
        chung, chỉ log).
      - `controllers/UserController.js`: đổi require tương tự + nhánh catch ở flow "HR chỉnh tay số
        ngày phép" (dòng ~772): cùng pattern `ArgumentInvalidException`/`LeaveLockTimeoutError` +
        `.statusCode`.
      - `controllers/AttendanceController.js`: chỉ đổi require (2 chỗ dùng `getLeaveBalance`, đọc
        thuần, không có nhánh `instanceof` nào).
      - **Tiện thể cập nhật 2 test file** (`__tests__/leaveRetroactive.test.js`,
        `__tests__/requestControllerCreate.test.js`) đang `require("../src/helpers/leaveBalance")` chỉ
        để gọi `getLeaveBalance` verify kết quả (không phải test cho chính file cũ) — đổi sang
        `require("../src/modules/leave")`, giảm bớt dependent của file cũ trước khi xoá ở 1.8.2.7.
        Không đổi `__tests__/leaveBalance.test.js` (đây chính là characterization test của file cũ,
        vẫn cần giữ cho tới khi xoá file ở 1.8.2.7).

      Verify thật: `tsc --noEmit` sạch; `eslint --fix` xử lý 2 lỗi format nhỏ (prettier), sau đó sạch.
      Chạy riêng `leaveBalance`/`leaveRetroactive`/`requestControllerCreate`/`requestApprovalFlow` — 3
      test fail nhưng đều thuộc `requestApprovalFlow.test.js`, xác nhận đây là 1 trong 4 suite lỗi cũ
      đã biết (không phải regression). Full suite ổn định `382/17`, đúng baseline, không giảm số pass.
- [x] 1.8.2.7 — Xoá `helpers/leaveBalance.js` sau khi xác nhận không còn ai require (grep sạch, chỉ còn
      1 dòng comment tham chiếu vô hại trong `get-leave-balance.service.ts`).

      **Phát hiện quan trọng trước khi xoá:** `__tests__/leaveBalance.test.js` (characterization test
      gốc của 1.8.2.1) require trực tiếp `helpers/leaveBalance.js` — nếu chỉ xoá file cũ mà không xử lý
      test này, sẽ MẤT HẲN toàn bộ lưới an toàn cho `modules/leave` (không phải chỉ mất 1 vài test, mà
      mất sạch — các test tạm mình viết để verify 1.8.2.2b→1.8.2.6 đều đã xoá sau khi dùng xong, không
      giữ lại permanent). Không được để xảy ra tình huống này.

      **Fix:** chuyển `__tests__/leaveBalance.test.js` → `__tests__/leaveBalance.test.ts` (file mới
      theo quy tắc TS, giữ tên cũ vì là hậu duệ trực tiếp), đổi import sang `modules/leave` (public API,
      không import thẳng path nội bộ), đổi `LeaveBalanceError` → `InsufficientLeaveBalanceError`/
      `ArgumentInvalidException` cho đúng exception mới. 1 test ("balance_after chỉ là snapshot") dùng
      `result.ledgerEntry.balance_after` từ return value gốc — nhưng
      `AdjustLeaveBalanceResult` mới chỉ trả `{ balance }` (đã bỏ `ledgerEntry` vì grep xác nhận không
      consumer thật nào dùng field này) — sửa test để query `LeaveBalanceModel.findOne(...)` lấy ledger
      row thay vì đọc từ return value, giữ nguyên ý nghĩa test (sửa tay `balance_after` không ảnh hưởng
      `getLeaveBalance` vì field này chỉ là snapshot hiển thị, không dùng trong `$sum`).

      Verify thật: chạy riêng file mới trước khi xoá file cũ — 9/9 test pass (SUM đúng, `isDeleted`
      filter, cô lập theo user, chặn âm, `allowNegative`, guard amount/reason, balance_after snapshot,
      race 2 lệnh đồng thời). Sau đó xoá cả `helpers/leaveBalance.js` và `__tests__/leaveBalance.test.js`
      (bản `.js` cũ). `tsc --noEmit` + `eslint` sạch. Full suite: 2 lần chạy trung gian flaky ở 2 suite
      KHÁC NHAU mỗi lần (`kpiMetric.test.js`, `__tests__/modules/request/get-my-requests.http.test.js`
      — lỗi "socket hang up"/"Parse Error" kiểu resource contention khi chạy nhiều MongoMemoryServer
      liên tiếp, không liên quan gì đến leave module), chạy lại cho kết quả ổn định `382/17` đúng
      baseline — xác nhận không phải regression.

**Definition of done 1.8.2 — ĐÃ ĐẠT:** `LeaveBalance` có module DDD đầy đủ
(`domain/leave-balance.entity.ts` + `.errors.ts`, `infrastructure/leave-balance.repository.ts` +
`leave-balance-lock.ts`, `application/adjust-leave-balance.service.ts` +
`get-leave-balance.service.ts`, `index.ts` public API), 4 consumer thật cutover xong
(`leaveHandler.js`, `jobs/autoRejectLeaveRequests.js`, `controllers/UserController.js`,
`controllers/AttendanceController.js`), `helpers/leaveBalance.js` xoá sạch, characterization test
chuyển thành `__tests__/leaveBalance.test.ts` (9 test, permanent). `npm test` toàn repo ổn định
`382/17` (17 fail cũ đã biết từ trước, không tăng).

### 1.8.3 — `modules/timesheet/` (chi tiết đầy đủ, phần khó nhất — làm tiếp theo 1.8.2)

**Research trước khi thiết kế (bằng Explore agent + tự verify lại từng điểm quan trọng — agent có 1
điểm báo sai, đã tự chạy test xác nhận):**

- **Logic tính work_unit/penalty nằm rải rác ở**: `src/helpers/attendanceHelper.ts` (`resolveAttendanceDay`
  — merge punch, tính work_unit/penalty, đã convert TS ở 1.7.1; `persistAttendanceDay`/`saveAttendanceDay`
  — ghi `WorkSheetModel` + derive `WorkDayStatusModel`), `src/helpers/attendancePenalty.js`
  (`buildLatePenaltyResolver`/`buildEarlyPenaltyResolver`/`buildForgotPenaltyResolver` — đọc tier từ
  `AttendancePenaltyModel`, `buildUnifiedForgotOccurrenceMap` — gộp request forgot_checkin đã duyệt +
  tự phát hiện thiếu punch thành 1 bộ đếm occurrence).
- **`AttendancePenaltyModel`** (`src/models/AttendancePenaltyModel.js`) — reference-data (đúng khái
  niệm "Generic Subdomain" ở mục 13, KHÔNG phải bounded context riêng): `type` (late/early/forgot),
  `from_minutes`/`to_minutes` (late/early) hoặc `from_count`/`to_count` (forgot), `penalty_kind`
  (money/work_unit/half_day_money), `penalty_value`, `effective_from` (hỗ trợ nhiều "thế hệ" tier theo
  thời gian), `is_active`.
- **5 entry point gọi `resolveAttendanceDay`/`saveAttendanceDay`** (đã tự grep xác nhận, nhiều hơn con số
  agent báo cáo ban đầu vì có thêm phát hiện ở `checkOut`):
  1. `AttendanceController.js` `importExcel()` (2 lần gọi — máy chấm công + app-only).
  2. `jobs/finalizeWorkDay.js` — cron 23h hàng ngày, tính lại toàn bộ worksheet hôm nay.
  3. `helpers/forgotCheckinHandler.js` `onApprove()` — sau khi duyệt đơn quên chấm công.
  4. `helpers/lateEarlyHandler.js` `onApprove()` — sau khi duyệt đơn đi trễ/về sớm có lý do.
  5. **`AttendanceController.js` `checkOut()`** — KHÔNG gọi `resolveAttendanceDay` (route real-time tự
     tính `minute_early` đơn giản bằng hiệu giờ ca, không qua tier), nhưng CÓ gọi
     `resolveLeaveConflictOnAttendance` trực tiếp — đây là entry point thứ 5 cho riêng hàm leave-conflict,
     độc lập với 4 entry point trên.
- **Phát hiện quan trọng — 2 lớp tính toán cho cùng dữ liệu, chưa từng được ghi nhận trước đây:**
  `checkIn()`/`checkOut()` (route real-time nhân viên tự bấm) ghi thẳng `worksheet.check_in`/
  `check_out` + tự tính `minutes_late`/`minute_early` "naive" (chỉ trừ giờ ca, KHÔNG qua penalty tier,
  chưa có `work_unit`/`penalty_amount`) — đây là lớp **optimistic, tạm thời**. Sau đó lớp
  **authoritative** (`resolveAttendanceDay` qua Excel import/cron 23h/duyệt đơn) mới tính lại đầy đủ
  (merge punch máy+app, áp tier phạt, derive `work_unit`/`penalty_amount`, resolve
  `WorkDayStatusModel` theo buổi) — GHI ĐÈ lên giá trị naive. Ảnh hưởng thiết kế: `WorkSheetModel`
  không phải "ghi 1 lần" mà được cập nhật qua nhiều giai đoạn bởi cả real-time route lẫn batch
  recalculation — càng củng cố quyết định owner dưới đây.
- **Đính chính báo cáo của Explore agent**: agent báo `attendanceMerge.test.js` đang "Passing" — SAI, tự
  chạy `npx jest attendanceMerge` xác nhận vẫn fail, đúng là 1 trong 4 suite lỗi cũ đã biết
  (`requestApprovalFlow`/`forgotCheckinApprove`/`approvalChain`/`attendanceMerge`). Bài học: luôn tự
  verify lại claim của subagent trước khi dùng để ra quyết định thiết kế, kể cả khi agent tự tin báo cáo.

**Quyết định kiến trúc — ai sở hữu `WorkSheetModel`? (đã hỏi người dùng, không tự quyết vì đây là fork
thật, ảnh hưởng cả 1.8.3 lẫn 1.8.4):**

`WorkSheetModel` bị ghi bởi cả field thô (`check_in`/`check_out`, "thuộc" Attendance theo tên gọi) lẫn
field dẫn xuất (`work_unit`/`penalty_amount`/`minutes_late`/`minute_early`, thuộc Timesheet) — và
`checkIn()`/`checkOut()` ghi CẢ HAI trong cùng 1 lần `save()`, không tách field ra được theo từng
module mà không viết lại schema. Theo luật #3 (mục 13: mỗi Mongoose model chỉ 1 owning repository),
**người dùng chọn: Timesheet sở hữu toàn bộ `WorkSheetModel`** (không tách schema, không đảo thứ tự
phase). Lý do ủng hộ: logic phức tạp/authoritative (ảnh hưởng lương thật) đã nằm ở Timesheet;
`WorkSheetModel` về bản chất là "bản ghi timesheet" được cập nhật dần qua nhiều giai đoạn (naive lúc
check-in/out, chính xác lúc batch recalculate), không phải "nhật ký chấm công thô" thuần tuý. Hệ quả:
`modules/attendance/` (1.8.4) sẽ KHÔNG có repository riêng cho `WorkSheetModel` — `checkIn`/`checkOut`
sẽ gọi qua public API của `modules/timesheet/` để ghi punch (quyết định cụ thể interface khi tới 1.8.4).

**Quyết định kiến trúc — `resolveLeaveConflictOnAttendance` xử lý thế nào khi chưa có `workflows/`?**

Hàm này cần CẢ `WorkDayStatusModel` (Timesheet sở hữu) LẪN `adjustLeaveBalance` (Leave module) — theo
luật #1 (mục 13), `modules/timesheet` không được import `modules/leave` trực tiếp. Nhưng `workflows/`
(nơi đúng ra nên đặt việc điều phối 2 module) chỉ xây ở 1.8.5, sau 1.8.3. **Quyết định (hệ quả tự nhiên
của luật #1 đã chốt, không phải fork mới cần hỏi thêm):** tách hàm gốc làm 2:
- Phần thuần Timesheet (đưa vào `modules/timesheet/`): nhận thông tin check-in/check-out phủ khoảng
  nghỉ nào, chỉ đọc/ghi `WorkDayStatusModel` (flip `leave_paid`/`leave_unpaid` → `present`), trả về số
  ngày cần hoàn (`refundAmount`), KHÔNG tự gọi `adjustLeaveBalance`.
- Phần gọi `adjustLeaveBalance` ở lại đúng chỗ gọi hiện tại (tạm thời, tại `checkOut()`,
  `leaveHandler.js` `onApprove/onReject`, `forgotCheckinHandler.js`, `lateEarlyHandler.js`) — các nơi
  này gọi `timesheetModule.resolveLeaveConflictOnAttendance(...)` rồi tự gọi
  `leaveModule.adjustLeaveBalance(...)` nếu `refundAmount > 0`. Đây là điều phối tạm thời tại call-site
  (đúng tinh thần Hướng B — đồng bộ, không event — nhưng chưa hình thức hoá thành file `workflows/`
  riêng), sẽ chuyển hẳn vào `workflows/record-checkout.workflow.ts` khi tới 1.8.5 mà không đổi hành vi.

**Task breakdown (theo đúng khuôn 1.8.2 — domain → infrastructure → application → cutover):**

- [x] 1.8.3.1 — Đánh giá characterization test hiện có + điều tra `attendanceMerge.test.js` đang fail
      (4/11 test) trước khi quyết định port y nguyên hay sửa. Test khác đã pass sẵn:
      `lateEarlyPenalty.test.js`, `forgotOccurrenceMap.test.js`, `attendanceAdminEdit.test.js`.

      **Điều tra chi tiết từng test fail (đọc code + trace thật bằng script `ts-node`, không suy
      đoán):**
      1. **"giá trị merge trùng giá trị đã lưu: trả unchanged"** — test assert `skip:true` khi data
         tính ra giống hệt bản đã lưu. Nhưng đọc `resolveAttendanceDay` thấy `skip:true` CHỈ trả về ở 2
         early-return guard đầu hàm (không có raw data + không forgot, hoặc không có worksheet) — nhánh
         "tính xong nhưng giống hệt" luôn là `skip:false, unchanged:true`. Verify thêm:
         `AttendanceController.js`/`finalizeWorkDay.js` đều gọi `saveAttendanceDay` bất kể `unchanged`,
         chỉ dùng field này để đếm thống kê, không dùng để bỏ qua persist. Kết luận: **test lỗi thời**
         (kỳ vọng sai cấu trúc return), không phải bug — sửa lại assertion cho đúng thiết kế thật.
      2. **"cặp giờ merge cách nhau < 120 phút: checkout bị loại"** — trace thật cho thấy
         `normalizeDayPunches` KHÔNG có bất kỳ rule nào loại checkout khi punch quá gần nhau. Kết luận:
         **gap nghiệp vụ thật** (rule được test kỳ vọng nhưng chưa từng được implement, hoặc đã mất).
      3 & 4. **2 test "thiếu checkout... giữ hành vi cũ work_unit = 0"** — trace thật: code hiện tại
         (nhánh fallback thêm khi có tính năng `forgotOccurrenceMap`) luôn cho `base/2` (0.5 ngày
         thường) khi `hasRequest:false`, hoặc `r.work_unit` (1, theo stub) khi `hasRequest:true` — KHÔNG
         bao giờ ra 0. Bằng chứng củng cố: test "Thứ 7" liền kề (đã pass sẵn) cũng expect `0.25 =
         0.5/2`, cùng công thức fallback — chứng tỏ `base/2` mới là hành vi NHẤT QUÁN hiện tại, còn kỳ
         vọng "= 0" của 2 test trên đã lỗi thời (có thể viết trước khi tính năng occurrence-map được
         thêm, không được cập nhật theo). Kết luận: **gap nghiệp vụ thật** (regression tiềm ẩn từ 1 lần
         thêm tính năng trước đây).

         **Đính chính sau khi đối chiếu SRS chính thức (xem đoạn "Đối chiếu với tài liệu SRS" trước
         mục 1.8.3.4):** #3&4 thực ra KHÔNG phải bug — SRS xác nhận rõ "chờ duyệt=0.5, đã duyệt=đủ
         công", khớp đúng code hiện tại. Kỳ vọng gốc "=0" của 2 test cũ mới là lỗi thời. #2 ("120 phút")
         vẫn chưa xác nhận được qua SRS, còn là gap mở thật.

      **Đã hỏi người dùng cách xử lý 2 gap nghiệp vụ thật (#2, #3&4) — chọn: port nguyên hành vi hiện
      tại, KHÔNG tự sửa rule nghiệp vụ** (an toàn nhất cho migration, không đổi kết quả lương của bất
      kỳ nhân viên nào; gap được ghi nhận rõ để xử lý sau, không lẫn với việc "coi như đã sửa").

      **Fix:** chuyển `attendanceMerge.test.js` → `attendanceMerge.test.ts` (theo quy tắc TS): sửa
      assertion #1 đúng thiết kế thật (`skip:false, unchanged:true`); sửa assertion #2, #3, #4 khớp
      ĐÚNG giá trị thật hiện tại (`work_unit` lần lượt `1`/`0.5`/`1` thay vì `0`), đổi tên test rõ ràng
      "hành vi hiện tại — gap nghiệp vụ, xem 1.8.3.1" (không còn ghi "giữ hành vi cũ" gây hiểu lầm là
      đã verify đúng), kèm comment giải thích ngắn gọn lý do + trỏ về mục này. Verify: 11/11 test pass.
      `tsc --noEmit` + `eslint` sạch. **Baseline test toàn repo cải thiện thật**: từ `382 passed/17
      failed` (4 suite lỗi cũ) xuống **`386 passed/13 failed`** (còn 3 suite:
      `requestApprovalFlow`/`forgotCheckinApprove`/`approvalChain` — `attendanceMerge` giờ xanh hoàn
      toàn). Từ giờ baseline tham chiếu cho các task sau là `386/13`, không phải `382/17` nữa.

      **Gap còn lại chưa có test trực tiếp** (chỉ test gián tiếp qua suite khác, cả 2 đều đang fail vì
      lý do không liên quan): `persistAttendanceDay`'s `WorkDayStatusModel` period-split logic,
      `resolveLeaveConflictOnAttendance` như 1 unit độc lập — sẽ viết test riêng khi port ở 1.8.3.4 nếu
      cần, không chặn việc bắt đầu 1.8.3.2/1.8.3.3.
- [x] 1.8.3.2 — `modules/timesheet/domain/` — `types.ts` (interface `WorksheetSnapshot`, `ForgotInfo`,
      `ForgotOccurrenceInfo`, `PenaltyOutcome`, `PenaltyResolver`) + `resolve-attendance-day.ts` (port
      `normalizeDayPunches`+`resolveAttendanceDay`+helper thuần `punchClassifyMidpoint`/
      `punchMinutesOfDay`/`toMinutesOfDay` từ `helpers/attendanceHelper.ts`).

      **Thay đổi cấu trúc có chủ đích (không đổi công thức nghiệp vụ):** bản gốc mutate trực tiếp
      `worksheet.check_in = ...` v.v. (vì gọi trên Mongoose document rồi `.save()`) — bản domain thuần
      này KHÔNG mutate input, chỉ trả kết quả qua return value; application layer (1.8.3.4) sẽ chịu
      trách nhiệm ghi qua repository. Đây là cải thiện cấu trúc an toàn (loại bỏ side-effect ẩn trong
      hàm tính toán thuần), không ảnh hưởng công thức tính — verify: bỏ 6 dòng mutate cuối hàm, phần
      tính `unchanged` vẫn dùng snapshot cũ so với giá trị mới TRƯỚC khi mutate (đúng thứ tự gốc), nên
      logic so sánh không đổi.

      **Tái dùng shared-kernel có chọn lọc**: dùng `Money` cho phép cộng `penalty_amount` (late +
      early — đúng chỗ Money được thiết kế cho, tránh sai số phép cộng tiền tệ). KHÔNG ép dùng
      `Period`/`DateKey`/`EmployeeId` ở đây — `Period` sẽ dùng đúng chỗ ở phần tách
      `resolveLeaveConflictOnAttendance` (1.8.3.4, đã verify khớp `isCoveredBy()` từ 1.8.1);
      `leavePeriodsMap`/`dateKey`/`rawIn`/`rawOut` giữ nguyên kiểu string/Map gốc vì caller (JS, chưa
      cutover tới 1.8.3.6) sẽ phải tạo ra các Map này — ép dùng VO ở boundary này tạo ma sát không cần
      thiết trước khi cutover.

      **Verify 3 lớp:**
      1. `tsc --noEmit` + `eslint` sạch.
      2. `__tests__/modules/timesheet/resolve-attendance-day.test.ts` (13 test, port nguyên 11 case từ
         `attendanceMerge.test.ts` + 1 case "skip khi không data" + 1 case xác nhận KHÔNG mutate input
         — điểm khác biệt có chủ đích). 13/13 pass.
      3. **Differential test 500 kịch bản ngẫu nhiên** (file tạm, xoá sau khi verify — so sánh trực
         tiếp `attendanceHelper.ts`'s `resolveAttendanceDay` (bản cũ) với bản mới trong
         `modules/timesheet/domain/`, cùng input, random hoá giờ vào/ra/forgot/occurrence/leave
         period/thứ 7 mỗi lần chạy): **0/500 mismatch** — cho độ tin cậy cao rằng port không có lỗi
         transcription nào ngoài thay đổi mutation đã nêu.

      Full suite: `399 passed / 13 failed` (tăng đúng 13 test mới so với baseline `386/13`, đúng 3
      suite lỗi cũ, không regression).
- [x] 1.8.3.3 — `modules/timesheet/infrastructure/` + phần domain bổ sung phát hiện trong lúc làm:

      **`domain/penalty-tier.ts`** (bổ sung — port từ `helpers/attendancePenalty.js`): tách phần chọn
      tier theo `effective_from`+ngưỡng (business rule thuần) ra khỏi phần fetch DB —
      `resolveLatePenaltyFromTiers`/`resolveEarlyPenaltyFromTiers`/`resolveForgotPenaltyFromTiers`
      (nhận tier list đã fetch sẵn, không tự query) + `buildUnifiedForgotOccurrenceMap` (đã thuần từ
      bản gốc, chỉ đổi vị trí). Sửa 1 lỗi tự phát hiện khi review lại: bản đầu vô tình đổi cách tính
      date-key trong `buildUnifiedForgotOccurrenceMap` từ `moment.tz(r.date, TZ)` (giờ VN) sang
      `getUTCFullYear/Month/Date` (UTC) — đúng loại bug timezone đã tìm thấy ở shared-kernel trước đây
      — tự phát hiện và sửa lại trước khi verify, không đợi review ngoài.

      **`domain/work-day-status-rules.ts`** (bổ sung — port từ `helpers/workDayStatusRules.ts`): file
      gốc chỉ có 1 consumer (`attendanceHelper.ts`, đang bị port) nên chuyển hẳn vào đây; bản gốc GIỮ
      NGUYÊN tới 1.8.3.7 (xoá cùng lúc với `attendanceHelper.ts`, tránh phá vỡ code cũ chưa cutover).

      **`infrastructure/penalty-policy.repository.ts`** — bọc `AttendancePenaltyModel`, compose domain
      function thuần ở trên với tier fetch 1 lần (đúng pattern gốc `buildXxxPenaltyResolver` — tối ưu
      cho batch job). Giữ nguyên `.sort({ effective_from: -1, from_minutes/from_count: 1 })` của query
      gốc dù domain function tự tính lại generation — phòng trường hợp tier overlap ngưỡng (không nên
      xảy ra nhưng không suy đoán, giữ đúng behavior gốc).

      **`infrastructure/work-sheet.repository.ts`** — sở hữu toàn bộ `WorkSheetModel` (quyết định kiến
      trúc ở đầu mục 1.8.3): `findByUserAndDate` (populate shifts, map về `{start_time, end_time}` thuần
      — không rò rỉ field Mongoose khác ra domain), `applyComputedResult` (ghi field đã tính từ
      `resolveAttendanceDay`).

      **`infrastructure/work-day-status.repository.ts`** — sở hữu toàn bộ `WorkDayStatusModel`. Port
      nguyên logic ghi status theo buổi của `persistAttendanceDay`, **giữ nguyên 2 điểm bất đối xứng
      phát hiện khi đọc kỹ bản gốc** (không tự "cân bằng" lại):
      1. Nhánh "cùng status cả 2 buổi": xoá status attendance-driven CHỈ ở period≠"full"+isDeleted:false,
         `$set` status mới cho period "full" (LUÔN ghi đè kể cả doc đã tồn tại).
      2. Nhánh "khác status theo buổi": xoá TẤT CẢ status attendance-driven ngày đó (không filter
         period/isDeleted), rồi `$setOnInsert` cho từng buổi — **business rule ẩn**: nếu do trùng
         unique index mà đụng 1 doc KHÔNG phải attendance-driven còn sót (vd `leave_paid` —
         decision-driven, deleteMany không xoá được), `$setOnInsert` KHÔNG ghi đè — tức là status
         quyết định thủ công (leave/remote/business_trip) được ưu tiên giữ nguyên trước tính toán chấm
         công tự động. Verify thật bằng test riêng cho đúng rule này (không chỉ test happy path).

      **Verify**: `tsc --noEmit` + `eslint` sạch trên toàn bộ. 47 test mới (22 penalty-tier thuần không
      cần DB + 4 penalty-policy.repository + 4 work-sheet.repository + 4 work-day-status.repository +
      13 đã có từ 1.8.3.2, tổng cộng 47 trong `__tests__/modules/timesheet/`), tất cả pass. Full suite:
      `433 passed / 13 failed` (tăng đúng 34 test mới so với baseline `399/13`), đúng 3 suite lỗi cũ,
      không regression.
**Đối chiếu với tài liệu SRS chính thức (`vWork - HRM website - Tài liệu SRS.pdf`, người dùng cung cấp)
trước khi làm 1.8.3.4 — quan trọng vì đây là nguồn spec chính thức, không phải suy đoán từ code:**

- **Đính chính 2 "gap nghiệp vụ" đã ghi ở 1.8.3.1 — KHÔNG phải bug, đã xác nhận đúng theo SRS:** SRS
  mục "Quên chấm công", cột "Hiển thị ở bảng chấm công": *"Chờ duyệt/hoặc đơn bị từ chối: hiển thị 0.5
  ngày công... Sau khi đơn được duyệt: hiển thị đủ ngày công"*. Code hiện tại (`hasRequest:false` →
  `work_unit=base/2`; `hasRequest:true` → `work_unit=r.work_unit`) khớp CHÍNH XÁC rule này. Kết luận:
  2 test cũ trong `attendanceMerge.test.js` (đã sửa ở 1.8.3.1) kỳ vọng `work_unit=0` là **kỳ vọng lỗi
  thời** (từ 1 phiên bản rule cũ trước SRS này), KHÔNG phải bug — port nguyên hành vi hiện tại là ĐÚNG,
  không cần lăn tăn thêm.
- **Gap thật mới phát hiện — Holiday không ảnh hưởng `work_unit` theo ngày:** SRS trang 11 (field "Công
  thực tế"): *"Nếu ngày lễ được cài trong hệ thống → mặc định hiển thị 1 ngày công"*. Verify thật:
  `calcStandardWorkUnits` (`helpers/payrollPeriod.js`) chỉ dùng Holiday để tính MẪU SỐ "Công chuẩn" ở
  tầng tổng hợp kỳ công — không liên quan `WorkSheetModel.work_unit`. `AttendanceController.js`'s hàm
  build mảng `daily` (nuôi "Bảng công của tôi") đọc thẳng `ws?.work_unit ?? null`, KHÔNG có override
  nào theo Holiday. `resolveAttendanceDay` (cả bản gốc lẫn bản port 1.8.3.2) cũng không tham chiếu
  Holiday. **Xác nhận: đây là thiếu sót thật, không phải chỉ nghi ngờ** — người dùng quyết định: ghi
  nhận, xử lý khi làm 1.8.3.4 (bổ sung Holiday context vào `resolveAttendanceDay`/application layer),
  không dừng lại sửa ngay bây giờ.
- **Vẫn chưa xác nhận được — rule "punch cách nhau <120 phút thì huỷ checkout"** (từ 1.8.3.1): tìm khắp
  SRS không thấy rule này ở đâu — SRS chỉ nói về số phút muộn/sớm tính từ giờ ca, không có rule về
  khoảng cách giữa check-in/check-out. Vẫn là gap mở, port nguyên hành vi hiện tại (không huỷ checkout).
- **Ghi nhận, ngoài phạm vi Timesheet — "3 lần đi muộn/về sớm miễn phạt tính CHUNG cho cả 2 loại":**
  đọc `finalizeWorkDay.js`'s `buildUserDayContext` — `lateForgivenSet`/`earlyForgivenSet` không hề có
  cap số lượng, bất kỳ đơn late/early nào được duyệt đều miễn phạt hoàn toàn. Nhưng đọc lại chính bảng
  rule chi tiết trong SRS (không phải phần định nghĩa tổng quan), "Đơn được duyệt: Miễn phạt" cũng ghi
  không điều kiện kể cả "từ lần thứ 4" (chỉ đổi cấp duyệt 1→2) — SRS có vẻ tự mâu thuẫn giữa phần định
  nghĩa và bảng rule chi tiết. Việc đếm gộp 2 loại thuộc luồng tạo đơn/approval chain (`modules/request`
  domain, không phải Timesheet) — chưa đọc code đó, để ngỏ, không chặn tiến độ 1.8.3.
- **Phát hiện phụ, thuộc phạm vi `modules/leave/` đã xong ở 1.8.2 (không sửa lại, chỉ ghi nhận):** SRS
  update 3/8/2026 thêm rule *"Được phép ứng trước TỐI ĐA 1 ngày phép của tháng liền kề"* —
  `adjustLeaveBalance`/`helpers/leaveBalance.js` gốc (đã port nguyên trạng) không có cap này,
  `allowNegative` cho phép âm không giới hạn. Người dùng xác nhận đây là **gap đã biết, hiện tại đang
  cố ý cho ứng phép thoải mái** — không phải lỗi port, không cần sửa trong migration này.

- [x] 1.8.3.4 — `modules/timesheet/application/persist-attendance-day.ts` — orchestrate 3 bước, GIỮ
      NGUYÊN đúng thứ tự gốc (quan trọng, xem phân tích dưới): (1) `workSheetRepository
      .applyComputedResult(...)` (thay `worksheet.save()`), (2)
      `workDayStatusRepository.findLeaveStatusesForDay` → domain `resolveLeaveConflict` (mới, port
      phần thuần của `resolveLeaveConflictOnAttendance`, dùng `Period.isCoveredBy()` từ shared-kernel —
      đúng chỗ được thiết kế, đã verify khớp qua truth-table ở 1.8.1) →
      `workDayStatusRepository.markStatusesPresent`, (3)
      `workDayStatusRepository.applyAttendanceDrivenStatus` (đã có từ 1.8.3.3). Trả về
      `{ leaveRefundAmount }` để caller (call-site hiện tại, tới khi có `workflows/` ở 1.8.5) tự gọi
      `adjustLeaveBalance`.

      **Phân tích quan trọng phát hiện lúc thiết kế — vì sao PHẢI giữ nguyên thứ tự (2) rồi (3), không
      "tối ưu" bỏ bước (2):** `resolveAttendanceDay` (domain) tự có cơ chế override
      `leaveMorning`/`leaveAfternoon` riêng (dùng CÙNG ngưỡng check-in-trước-12h/check-out-sau-ngưỡng
      với `resolveLeaveConflict`) — ảnh hưởng `missedIn`/`missedOut` → `morningStatus`/`afternoonStatus`
      mà bước (3) ghi. Vì bước (3) xoá TẤT CẢ attendance-driven status trước khi ghi lại, việc bước (2)
      flip leave_paid/leave_unpaid → present **bị ghi đè/xoá ngay sau đó** — verify thật bằng test tích
      hợp: doc leave gốc bị xoá hẳn (không phải update), thay bằng 1 doc "full"/status đúng từ bước (3).
      Tức là tác dụng THẬT SỰ LÂU DÀI của bước (2) không phải ghi WorkDayStatusModel (transient) mà là
      **tính đúng `refundAmount`** (giá trị này KHÔNG bị ảnh hưởng bởi việc doc bị xoá sau đó, vì đã
      tính xong trước khi bước (3) chạy). Quyết định: **không tự "tối ưu" bỏ ghi status ở bước (2)**
      dù có vẻ dư — giữ nguyên để không suy đoán sai 1 edge case nào (an toàn hơn cho migration).

      **Sửa 1 lỗi tự phát hiện khi viết `WorkDayStatusRepository.markStatusesPresent`:** bản đầu dùng
      `Promise.all` để flip nhiều status cùng lúc — SAI vì MongoDB `ClientSession` không hỗ trợ chạy
      đồng thời nhiều operation trên cùng 1 session (sẽ lỗi "session in use" khi có transaction). Sửa
      lại vòng lặp tuần tự (`for..of` + `await`), giữ đúng cách bản gốc.

      **Verify**: `tsc`/`eslint` sạch. 12 test cho `resolveLeaveConflict` (domain, thuần — bao phủ đủ
      case: thiếu check-in/out, không có leave status, che phủ buổi sáng/chiều/cả ngày, period "full"
      cần che phủ CẢ 2 buổi mới đè, leave_unpaid không hoàn phép, thứ 7 hoàn 0.5 không phải 1, nhiều
      leave status cộng dồn đúng) + 4 test repository mới (`findLeaveStatusesForDay`/
      `markStatusesPresent`) + 3 test tích hợp `persistAttendanceDay` (đầy đủ end-to-end domain+
      application, gồm đúng case "leave-conflict transient bị ghi đè lại nhưng refund vẫn đúng" nêu
      trên). Full suite: `453 passed/13 failed` (tăng đúng 20 test mới so với baseline `433/13`), đúng
      3 suite lỗi cũ, không regression.

      **Holiday-awareness (từ phát hiện SRS) — CHƯA làm trong task này, tách thành 1.8.3.4b riêng:**
      quyết định không bó vào cùng task này vì đây là tính năng MỚI (không phải port hành vi có sẵn) —
      trộn "port giữ nguyên hành vi" với "thêm business logic mới" vào cùng 1 review sẽ khó tách bạch
      rủi ro. Cần thiết kế riêng: vị trí thêm logic, cách xử lý `pay_policy`/`duration_days` của
      `HolidayModel` (SRS chỉ nói "mặc định 1 ngày công", chưa rõ có áp dụng cho holiday `unpaid` hay
      `duration_days < 1` không), tương tác với absence/leave status đã có sẵn trong ngày đó.
- [x] 1.8.3.4b — (task mới, tách từ phát hiện SRS) `modules/timesheet` — bổ sung Holiday-awareness cho
      `work_unit` theo đúng SRS ("ngày lễ → mặc định 1 ngày công"). Cần làm rõ trước khi code: vị trí
      (domain thuần hay 1 bước riêng ở application layer), nguồn Holiday data (thêm
      `holiday-policy.repository.ts` bọc `HolidayModel`?), tương tác với `pay_policy`/`duration_days`.

      **Quyết định nghiệp vụ (người dùng chốt qua AskUserQuestion):** (1) `work_unit` mặc định LUÔN = 1
      (không theo `duration_days` của Holiday), thứ 7 vẫn theo quy ước sẵn có = 0.5, Chủ nhật không có
      default (vốn không phải ngày công chuẩn); (2) CHỈ áp dụng cho Holiday `pay_policy: "paid"`; (3)
      chỉ điền vào ngày CHƯA có `WorkSheetModel` nào — không ghi đè `work_unit` đã tính từ luồng khác
      (leave/absence/business_trip...).

      **Course-correction quan trọng phát hiện lúc code (khác phương án ban đầu đã chọn):** phương án
      đầu (được chọn trước khi đọc kỹ code) là ghép vào `finalizeWorkDay` cron — nhưng đọc lại cron này
      mới thấy nó CHỈ query `WorkSheetModel` có sẵn `check_in`/`check_out` (`$or: [{check_in:{$ne:null}},
      {check_out:{$ne:null}}]`), nên không bao giờ chạm ngày lễ thuần (không ai chấm công). Làm theo cron
      sẽ phải tạo `WorkSheetModel` mới cho MỌI nhân viên MỌI ngày lễ — đụng `modules/user` (chưa tồn
      tại) để lấy danh sách "user đang active", phạm vi/rủi ro lớn hơn nhiều so với cần thiết.

      Đọc kỹ tiếp thì phát hiện gốc rễ gap thực ra nằm ở PHÍA ĐỌC: `AttendanceController.js`'s
      `getPayrollStats` (dòng ~559, "Bảng công của tôi") đã query `HolidayModel` sẵn nhưng CHỈ dùng để
      trừ mẫu số `standard_work_units` qua `calcStandardWorkUnits` — biến `holidays` không hề ảnh hưởng
      tử số (`work_unit`/`work_unit_total`). Nghiêm trọng hơn: `allDates` (danh sách ngày hiển thị
      trong `daily`) chỉ gộp từ `wsMap`/`dsMap`/`reqMap`/`forgotReqMap` đã tồn tại — 1 ngày lễ thuần
      hoàn toàn KHÔNG xuất hiện trong `daily`, chứ không chỉ là `work_unit: null`. Đã quay lại hỏi
      người dùng course-correct sang sửa phía đọc thay vì cron write — được chọn (cũng thấy tương tự ở
      `getPayrollStatsAll`, dòng ~907, endpoint bulk cho admin xem nhiều nhân viên cùng lúc — CÙNG 1
      loại gap, cần sửa cả 2 chỗ cho nhất quán payroll).

      **Implement:**
      - `modules/timesheet/domain/holiday-work-unit.ts` — hàm thuần
        `buildHolidayDefaultWorkUnitMap(holidays, branchId)`, lọc `pay_policy==="paid"` +
        `scope_type==="all"` hoặc branch khớp (giống logic lọc của `calcStandardWorkUnits` sẵn có), trả
        `Map<dateKey, workUnit>` (1 cho ngày thường, 0.5 cho thứ 7, bỏ qua Chủ nhật). Export qua
        `modules/timesheet/index.ts` (`buildHolidayDefaultWorkUnitMap` + type `HolidaySnapshot`) — hàm
        thuần domain, đúng pattern đã dùng cho `buildUnifiedForgotOccurrenceMap`, không cần bọc
        application/repository riêng vì caller (`AttendanceController.js`) tự query `HolidayModel` sẵn.
      - `AttendanceController.js`'s `getPayrollStats`: thêm `holidayDefaultMap` vào `allDates`; trong
        `.map(dateStr => ...)`, nhánh `else if (holidayDefaultWorkUnit)` (chỉ chạy khi `!ws`) cộng vào
        `work_unit_total`/`work_unit_official`/`work_unit_probation`; field trả về đổi thành
        `work_unit: ws?.work_unit ?? holidayDefaultWorkUnit ?? null`.
      - `getPayrollStatsAll`: tương tự nhưng theo branch của TỪNG user trong vòng lặp (dùng
        `holidayDefaultMapForBranch(u.branch_id)` memoized giống cách `standardUnitsForBranch` đã làm
        sẵn) — chỉ cộng tổng `work_unit_total`/`work_unit_official`/`work_unit_probation`, không có
        `daily` breakdown ở endpoint này nên không cần sửa field khác.
      - **Không đụng** `getStandardWorkUnits` (dòng ~1503) — endpoint này chỉ trả `standard_work_units`
        (mẫu số), đã đúng từ trước, không liên quan gap này.

      **Verify:** `tsc`/`eslint` sạch. 7 test thuần cho `buildHolidayDefaultWorkUnitMap` (weekday=1,
      thứ 7=0.5, Chủ nhật=không có default, unpaid=không có default, scope branch khớp/không khớp,
      input rỗng). 4 test tích hợp `attendancePayrollStatsHoliday.test.ts`: `getPayrollStats` ngày lễ
      paid không worksheet → `daily` có entry `work_unit=1`; ngày lễ nhưng ĐÃ có worksheet (work_unit=0
      từ luồng khác) → giữ nguyên, không bị ghi đè; ngày lễ unpaid → không có default;
      `getPayrollStatsAll` (admin xem nhiều người) → `work_unit_total` cộng đúng default cho user chưa
      có worksheet ngày lễ. Full suite ổn định `464 passed/8 failed` (tăng đúng 11 test so với baseline
      `453/8`), đúng 2 suite lỗi cũ, không regression.
- [x] 1.8.3.5 — `modules/timesheet/index.ts` — public API.

      **Bổ sung 2 file application mới (cần thiết để index.ts có API hoàn chỉnh, không phải scope
      creep — không có thì module không dùng được từ ngoài):**
      - `application/process-attendance-day.ts` — gộp domain `resolveAttendanceDay` (tính toán thuần)
        + application `persistAttendanceDay` (ghi qua repository) thành 1 use-case duy nhất
        `processAttendanceDay(...)`, để caller không cần biết ranh giới domain/application nội bộ —
        gọi 1 hàm, check `result.skip`/`result.unchanged` (giữ đúng pattern caller hiện tại đang dùng
        khi đếm thống kê import/finalize).
      - `application/get-worksheet-for-day.service.ts` — đọc thuần (`getWorksheetForDay`), không lock,
        bọc `WorkSheetRepository.findByUserAndDate` — cần thiết vì Timesheet sở hữu toàn bộ
        `WorkSheetModel`, caller ngoài module không còn cách nào khác để đọc worksheet.

      `index.ts` export: `processAttendanceDay`, `getWorksheetForDay` + type liên quan
      (`ProcessAttendanceDayInput/Result`, `WorkSheetRecord`, `WorksheetSnapshot`, `ShiftInfo`,
      `ForgotInfo`, `ForgotOccurrenceInfo`, `PenaltyOutcome`, `PenaltyResolver`) — KHÔNG export
      Repository/domain function nội bộ (`resolveAttendanceDay`/`persistAttendanceDay` riêng lẻ,
      `WorkSheetRepository`/`WorkDayStatusRepository`/`PenaltyPolicyRepository`).

      **Chưa giải quyết, để ngỏ tới 1.8.3.6:** cách tạo mới `WorkSheetModel` khi chưa có cho 1 ngày
      (hiện repository chỉ có `findByUserAndDate`+`applyComputedResult`, chưa có create/upsert) — sẽ rõ
      khi đọc kỹ từng entry point thật ở 1.8.3.6, tránh đoán trước khi chưa cần.

      Verify: `tsc`/`eslint` sạch. 2 test integration qua `index.ts` (không import path nội bộ): luồng
      đầy đủ `getWorksheetForDay` → `processAttendanceDay` ghi đúng `work_unit`; case `skip:true` không
      ghi gì. Verify encapsulation bằng `@ts-expect-error` cố tình import `WorkSheetRepository` từ
      `modules/timesheet` — biên dịch báo lỗi đúng như kỳ vọng. Full suite: `455 passed/13 failed`
      (tăng đúng 2 so với baseline `453/13`), không regression.
- [x] 1.8.3.6 — Cutover 5 entry point (xem danh sách ở trên) + phần gọi `adjustLeaveBalance` tại
      call-site sau khi có `refundAmount` từ Timesheet. ĐÃ XONG CẢ 5/5, xem chi tiết từng cái bên
      dưới.

      **Phát hiện quan trọng trước khi bắt đầu — giải quyết câu hỏi mở "tạo mới WorkSheetModel" từ
      1.8.3.5:** đọc kỹ cả 2 luồng (`finalizeWorkDay.js`, `importExcel`) xác nhận KHÔNG entry point nào
      tự tạo `WorkSheetModel` mới — nếu không có worksheet sẵn cho ngày đó, `resolveAttendanceDay` tự
      `skip`. Worksheet được tạo ở nơi khác (gán ca làm việc), ngoài phạm vi Timesheet. Không cần thêm
      method create/upsert.

      **Quyết định phạm vi cutover (đã hỏi người dùng trước khi làm):** phần "build context"
      (`buildUserDayContext` — query `WorkSheetModel`/`WorkDayStatusModel`/`RequestModel` để dựng
      `leavePeriodsMap`/`forgotOccurrenceMap`/v.v.) **giữ nguyên trong file legacy**, không chuyển vào
      Timesheet — vì cần dữ liệu `RequestModel` (module Request), đúng ra thuộc `workflows/` (1.8.5),
      chưa nên nhét vào riêng Timesheet ngay. Chỉ cutover phần lõi: `resolveAttendanceDay`+
      `saveAttendanceDay` → `processAttendanceDay` (module `timesheet`).

      **Bổ sung ngoài kế hoạch ban đầu (cần thiết để cutover trọn vẹn):** nhận ra
      `buildLatePenaltyResolver`/`buildEarlyPenaltyResolver`/`buildForgotPenaltyResolver`/
      `buildUnifiedForgotOccurrenceMap` (từ `helpers/attendancePenalty.js`, cũng nằm trong danh sách
      xoá ở 1.8.3.7) cũng cần cutover cùng lúc — nếu không, `AttendancePenaltyModel` vẫn bị truy cập
      qua 2 đường song song (`helpers/attendancePenalty.js` cũ + `PenaltyPolicyRepository` mới), và sẽ
      phải động lại đúng những file này lần nữa ở 1.8.3.7. Thêm
      `application/build-penalty-resolvers.service.ts` (wrapper thuần quanh
      `PenaltyPolicyRepository`) + export `buildUnifiedForgotOccurrenceMap` thẳng từ
      `domain/penalty-tier.ts` qua `index.ts`.

      **1/5 entry point xong — `jobs/finalizeWorkDay.js`:** đổi require `helpers/attendancePenalty.js`
      + `helpers/attendanceHelper.js`'s `resolveAttendanceDay`/`saveAttendanceDay` → `modules/timesheet`
      (giữ `normalizeDayPunches` từ `attendanceHelper.ts` vì `buildUserDayContext` vẫn cần, chưa
      cutover). `buildUserDayContext` giữ nguyên 100% (đúng quyết định phạm vi trên).

      **Chưa từng có test nào cho file này trước khi cutover** — viết mới
      `__tests__/finalizeWorkDay.test.ts` (4 test, gọi `finalizeWorkDay(dateKey)` trực tiếp với DB
      thật): worksheet có đủ check-in/out → xử lý đúng, tạo status "full"/"present"; worksheet không có
      gì → bị loại khỏi query, không đổi; đi muộn theo tier thật trong DB → phạt tiền đúng; dọn status
      "pending" sót lại thành "absent". Cả 4 pass với cutover mới. `tsc`/`eslint` sạch. Full suite:
      `459 passed/13 failed` (tăng đúng 4 so với baseline `455/13`), không regression.

      **Còn lại 4/5 entry point + phần `adjustLeaveBalance` tại checkOut/handler:** làm tiếp ở các lượt
      sau, mỗi lần dừng lại review theo đúng quy tắc.

      **Bug thật nghiêm trọng tự phát hiện khi đọc `forgotCheckinHandler.js`'s `onApprove` (đợt cutover
      tiếp theo):**
      1. **Đính chính lại phát hiện "không entry point nào tạo mới WorkSheetModel"** (ghi ở đầu mục
         1.8.3.6) — SAI, `forgotCheckinHandler.js`'s `onApprove` (dòng 215-230) THẬT SỰ tạo mới
         `WorkSheetModel` (với `shifts: []`) nếu chưa có cho ngày đó, qua `findOneAndUpdate` rồi
         `create` nếu không tìm thấy. Cần bổ sung method upsert vào `WorkSheetRepository` khi cutover
         file này (chưa làm ở lần này, để lượt cutover `forgotCheckinHandler.js` tiếp theo).
      2. **Bug timezone thật trong `WorkSheetRepository.findByUserAndDate`** (viết từ 1.8.3.3, chưa ai
         phát hiện tới giờ): dùng `Date.setHours(0,0,0,0)`/`setDate(+1)` — 2 hàm này tính theo timezone
         **LOCAL CỦA SERVER** (không phải Asia/Ho_Chi_Minh tường minh như quy ước còn lại của module).
         Verify thật bằng process con riêng (`TZ=America/New_York node -e ...`, không phải mutate
         `process.env.TZ` giữa chừng trong Jest — đã tự kiểm chứng cách đó KHÔNG có tác dụng vì
         V8/Jest cache timezone lúc khởi động process): lệch đúng 13 tiếng so với giá trị đúng. Máy
         dev đang chạy `Asia/Saigon` (`Intl.DateTimeFormat().resolvedOptions().timeZone`) nên bug này
         chưa từng bộc lộ qua test — chỉ xuất hiện nếu server production chạy timezone khác (rất có
         thể xảy ra, vd container mặc định UTC), sẽ khiến toàn bộ tra cứu worksheet sai ngày hoàn toàn.
         **Fix:** đổi sang `moment.tz(date, TZ).format(...)` + `startOf("day")`/`.add(1,"day")` tường
         minh, khớp đúng convention còn lại của module. Verify lại bằng process con: khớp chính xác sau
         khi sửa. Thêm test permanent dùng mốc UTC cố định (không phụ thuộc timezone máy chạy test) để
         phủ đúng ranh giới ngày giờ VN — không dùng cách mutate `process.env.TZ` (không tin cậy trong
         Jest, đã tự kiểm chứng).

      Bài học: dù đã verify kỹ ở 1.8.3.3 (test pass), vẫn sót 1 bug thật vì mọi test trước đó đều seed
      data bằng UTC ISO string cố định — vô tình "che" bug vì máy chạy test SẴN đã ở đúng Asia/Saigon.
      Cần cẩn trọng hơn khi verify logic liên quan timezone: luôn tự hỏi "test này có thực sự phụ thuộc
      giả định về timezone máy chạy hay không", không chỉ dựa vào test pass là đủ.

      **2/5 entry point xong — `helpers/forgotCheckinHandler.js`'s `onApprove`:**
      - Thêm `WorkSheetRepository.upsertRawPunch()` (port đúng logic gốc: `findOneAndUpdate` trước,
        `create` với `shifts: []` nếu không match — KHÔNG dùng `{upsert:true}` 1 bước vì bản gốc chỉ
        set `shifts: []` lúc tạo mới, giữ nguyên shift thật khi update) + application wrapper
        `recordRawPunch()`, export qua `index.ts`. Business rule "cứu giờ ra về bị đọc nhầm vào
        check_in" (đặc thù luồng duyệt đơn quên chấm công) GIỮ NGUYÊN trong `forgotCheckinHandler.js`
        — không kéo vào Timesheet vì đây là quyết định của Request domain khi merge dữ liệu đơn với
        worksheet, Timesheet chỉ nhận `clockUpdate` đã tính sẵn để ghi.
      - Đổi require `attendanceHelper.js`/`attendancePenalty.js` → `modules/timesheet`
        (`processAttendanceDay`, `getWorksheetForDay`, `recordRawPunch`,
        `buildLatePenaltyResolver`/v.v.). `computeForgotOccurrence`'s `WorkSheetModel.find(...)` (query
        nhiều ngày trong tháng, phần "build context") GIỮ NGUYÊN theo đúng quyết định phạm vi.
      - **Chuyển `__tests__/forgotCheckinApprove.test.js` → `.ts`, đổi `MongoMemoryServer` →
        `MongoMemoryReplSet`** (đã verify: lỗi "Transaction numbers are only allowed on a replica set
        member" là lỗi MÔI TRƯỜNG TEST thuần tuý — code cũ TRƯỚC cutover cũng pass hết 5/5 nếu chỉ đổi
        ReplSet, không cần sửa gì logic). **Kết quả: cả 5 test pass với code đã cutover** — suite này
        chuyển từ "lỗi cũ đã biết" sang XANH HOÀN TOÀN, giảm danh sách lỗi cũ từ 4 xuống còn 2
        (`requestApprovalFlow`, `approvalChain`).
      - Thêm 3 test cho `upsertRawPunch` (tạo mới với `shifts:[]`, giữ nguyên shift thật khi update,
        chỉ update field punch được truyền vào không đụng field kia).

      `tsc`/`eslint` sạch. Full suite: `468 passed/8 failed` (tăng 8 so với `460/13` — 3 test mới +
      5 test chuyển từ fail sang pass), chỉ còn 2 suite lỗi cũ.

      **3/5 entry point xong — `helpers/lateEarlyHandler.js`'s `onApprove`:** đơn giản hơn
      `forgotCheckinHandler.js` (không tạo mới worksheet, chỉ tìm + guard `!worksheet ||
      (!check_in && !check_out)` rồi return sớm). Đổi `WorkSheetModel.findOne(...).populate("shifts")`
      → `getWorksheetForDay`, `resolveAttendanceDay`+`saveAttendanceDay` → `processAttendanceDay`.
      Chưa từng có test nào cho hàm này — viết mới `__tests__/lateEarlyApprove.test.ts` (3 test: đơn đi
      muộn có lý do được miễn phạt đúng; không có worksheet → không làm gì không lỗi; worksheet không
      có punch nào → không đổi `work_unit`). Cả 3 pass. `tsc`/`eslint` sạch. Full suite: `471 passed/8
      failed` (tăng đúng 3 so với `468/8`), không regression, vẫn chỉ 2 suite lỗi cũ.

      **4/5 entry point xong — `AttendanceController.js`'s `checkOut` route.** Đây là entry point
      KHÁC LOẠI với 3 cái trước — không gọi `resolveAttendanceDay`/`saveAttendanceDay` (thuộc lớp
      "optimistic real-time", Attendance module territory 1.8.4), chỉ gọi trực tiếp
      `resolveLeaveConflictOnAttendance` (từ `leaveHandler.js`).

      **Tách `applyLeaveConflictOverride` thành application function riêng** (trích xuất từ
      `persistAttendanceDay`, refactor lại để dùng chung — verify không regression bằng cách chạy lại
      toàn bộ 73 test `modules/timesheet` sau khi trích xuất) — vì `checkOut` cần logic leave-conflict
      NHƯNG không đi qua `resolveAttendanceDay`/`processAttendanceDay` đầy đủ. Đổi
      `resolveLeaveConflictOnAttendance` (leaveHandler.js) → `applyLeaveConflictOverride`
      (modules/timesheet), rồi tự gọi `adjustLeaveBalance` (modules/leave) nếu `leaveRefundAmount > 0`
      — thay cho việc gọi ẩn bên trong hàm cũ (đúng quyết định kiến trúc: Timesheet không được gọi
      thẳng Leave, tách 2 bước rõ ràng tại call-site).

      **Phát hiện quan trọng về test infrastructure (áp dụng cho MỌI test dùng transaction thật sau
      này):** viết characterization test mới cho `checkOut` (chưa từng có) liên tục fail với lỗi
      `"Unable to write to collection ... due to catalog changes; please retry the operation"` dù logic
      cutover đúng. Điều tra kỹ (không đoán bừa, thử nhiều giả thuyết): KHÔNG phải do thiếu
      `MongoMemoryReplSet`, KHÔNG phải do collection chưa tồn tại vật lý (đã thử `createCollection()` +
      insert/delete thật, vẫn lỗi) — nguyên nhân THẬT: **Mongoose tự động build index nền (background)
      cho 1 Model ngay lần đầu được dùng, không đợi (`await`) xong** — nếu lần dùng đầu tiên của 1
      Model (có index khai báo trong schema) xảy ra NGAY BÊN TRONG 1 transaction, việc build index chạy
      song song đụng độ với transaction, MongoDB coi là "catalog changes" và abort. Fix: gọi
      `Model.init()` (đợi index build xong) cho MỌI model liên quan trong `beforeAll`, TRƯỚC khi chạy
      bất kỳ test nào có transaction thật. Verify: sau khi thêm `Promise.all([...Model.init()])`, lỗi
      biến mất hoàn toàn, chạy lại 3 lần liên tiếp đều ổn định.

      Tiện thể phát hiện 1 lỗi nhỏ trong chính test mình viết: `checkOut` không gọi `res.status(200)`
      tường minh cho thành công (chỉ `res.json(...)`, Express tự mặc định 200) — assertion ban đầu
      `expect(res.status).toHaveBeenCalledWith(200)` sai từ đầu, sửa lại kiểm tra qua nội dung
      `res.json`.

      Viết mới `__tests__/attendanceCheckOut.test.ts` (2 test: check-out thường không có leave
      conflict; check-out che phủ leave_paid buổi chiều → flip present + tạo ledger hoàn đúng 0.5
      phép) + 2 test cho `applyLeaveConflictOverride` dùng độc lập. Cả 4 pass ổn định (chạy lại 3 lần).
      `tsc`/`eslint` sạch. Full suite: `475 passed/8 failed` (tăng đúng 4 so với `471/8`), không
      regression, vẫn 2 suite lỗi cũ.

      **5/5 entry point xong — `AttendanceController.js`'s `importExcel` (2 lần gọi trong 1 hàm).**
      Entry point phức tạp nhất: 2 vòng lặp riêng (1 cho ngày có dữ liệu Excel, 1 cho ngày chỉ có dữ
      liệu app không có trong Excel), cùng dùng chung context xây từ `Promise.all` 7 query khác nhau
      (worksheets tuần/tháng, forgot/late/early request đã duyệt, leave/remote status tuần/tháng).

      **Giữ nguyên phạm vi tối thiểu (đúng quyết định đã chốt):** TOÀN BỘ phần build context (7 query
      Promise.all, `worksheetMap`/`monthWorksheetMap`/`daySnapshots`/`excelRawMap`...) GIỮ NGUYÊN,
      không đụng — chỉ thay 2 cặp `resolveAttendanceDay`+`saveAttendanceDay` bằng `processAttendanceDay`
      (module `timesheet`), và đổi import `buildLatePenaltyResolver`/`buildEarlyPenaltyResolver`/
      `buildForgotPenaltyResolver`/`buildUnifiedForgotOccurrenceMap` từ `helpers/attendancePenalty.js`
      sang `modules/timesheet` (khớp cách đã làm ở `finalizeWorkDay.js`).

      **Điều chỉnh cần thiết khi cutover:** `processAttendanceDay` yêu cầu `worksheetId` tường minh —
      trong khi `resolveAttendanceDay` gốc tự xử lý an toàn `worksheet: undefined` (trả `skip:true`).
      Vòng lặp đầu tiên (`worksheetMap.get(dateKey)` có thể `undefined` nếu ngày đó nhân viên không có
      ca) cần thêm guard `if (!worksheet) { skipped++; continue; }` TRƯỚC khi gọi
      `processAttendanceDay` (tránh crash khi đọc `worksheet._id` của `undefined`) — giữ đúng kết quả
      cuối (vẫn tính vào `skipped`, chỉ đổi vị trí kiểm tra sớm hơn 1 bước). Vòng lặp thứ 2 (duyệt
      trực tiếp `worksheetMap` entries) không cần guard này vì `worksheet` luôn tồn tại khi lặp qua map.

      Chưa từng có test nào cho `importExcel` — viết mới `__tests__/attendanceImportExcel.test.ts` (4
      test, tự dựng file Excel thật bằng package `xlsx` đúng định dạng `parseExcelToBlocks`/
      `parseDayRows` mong đợi: import ngày công bình thường tính đúng `work_unit`/`minutes_late`; mã
      máy chấm công không map → vào `unmatched_codes`; ngày không có worksheet → tính vào `skipped`
      không lỗi; import 2 lần dữ liệu giống hệt → lần 2 vào `unchanged`). Cả 4 pass ổn định (chạy lại 3
      lần). `tsc`/`eslint` sạch. Full suite ổn định `479 passed/8 failed` (tăng đúng 4 so với `475/8`,
      1 lần chạy ra suite lạ `get-all-requests.http.test.js` fail — chạy lại ngay cho kết quả ổn định,
      xác nhận flaky không liên quan), vẫn chỉ 2 suite lỗi cũ.

      **TASK 1.8.3.6 HOÀN TẤT — cả 5/5 entry point đã cutover khỏi `helpers/attendanceHelper.js`'s
      `resolveAttendanceDay`/`saveAttendanceDay` và `helpers/attendancePenalty.js`, chuyển hết sang
      `modules/timesheet`.** Sẵn sàng cho 1.8.3.7 (xoá code cũ).
- [x] 1.8.3.7 — Xoá `attendanceHelper.ts`'s `resolveAttendanceDay`/`persistAttendanceDay`/
      `saveAttendanceDay`, `attendancePenalty.js`, phần `resolveLeaveConflictOnAttendance` cũ trong
      `leaveHandler.js` sau khi cutover xanh.

      **Phát hiện quan trọng trước khi xoá được:** `resolveLeaveConflictOnAttendance` (leaveHandler.js)
      còn 2 call site SẢN XUẤT chưa từng nằm trong danh sách "5 entry point" của 1.8.3.6 (vì đó là
      entry point của module `request`/`leave`, không phải `attendance`):
      1. `leaveHandler.js`'s `onApprove` (duyệt đơn nghỉ) — cuối hàm, loop `refreshed` worksheet để
         re-check nghỉ phép có bị đè bởi chấm công thật đã ghi nhận trước đó không.
      2. `awayDayHandler.js`'s `createOnApprove(status)` — dùng chung cho duyệt đơn `business_trip`/
         `client_visit`/`remote` (đã có test `requestControllerCreate.test.js` dòng 488 xác nhận hành
         vi hoàn phép này).
      Cả 2 đã cutover sang `applyLeaveConflictOverride` (modules/timesheet) + gọi `adjustLeaveBalance`
      tường minh tại call-site khi `leaveRefundAmount > 0` — đúng pattern đã dùng ở `checkOut`
      (1.8.3.6). Verify: `requestControllerCreate.test.js` (26 test, có test dòng 488 test đúng nhánh
      awayDayHandler+refund) pass 23/23 (3 fail còn lại thuộc `requestApprovalFlow.test.js`, suite lỗi
      cũ không liên quan, chạy trong cùng lệnh test).

      Sau khi cutover 2 call site trên, xoá an toàn: `resolveLeaveConflictOnAttendance` (hàm + export)
      khỏi `leaveHandler.js`; `resolveAttendanceDay`/`persistAttendanceDay`(private)/`saveAttendanceDay`
      + 3 interface liên quan khỏi `attendanceHelper.ts` (giữ nguyên `parseExcelToBlocks`/`parseDayRows`/
      `normalizeDayPunches`/`correctDayStatuses` — vẫn được dùng); xoá luôn import không còn dùng
      (`mongoose`, `ClientSession`, `resolveLeaveConflictOnAttendance`, `WorkDayStatusModel`,
      `ATTENDANCE_DRIVEN_STATUSES`) trong `attendanceHelper.ts`. Xoá hẳn `src/helpers/attendancePenalty.js`
      (đã grep xác nhận không còn require sản xuất nào, chỉ còn 2 test file cũ).

      **Test cũ bị xoá cùng code (không thể giữ vì code nền đã mất), đã verify coverage tương đương đã
      có sẵn trước khi xoá:** `attendanceMerge.test.ts` (12 test merge máy/app) ↔ mirror 1:1 trong
      `resolve-attendance-day.test.ts` (13 test, cùng tên, +2 test mới); `forgotOccurrenceMap.test.js`
      (6 test) ↔ mirror 1:1 trong `penalty-tier.test.ts`'s `describe("buildUnifiedForgotOccurrenceMap")`
      (cùng 6 tên test); `lateEarlyPenalty.test.js` — describe đầu (test tier thật từ DB) ↔ mirror trong
      `penalty-policy.repository.test.ts`, NHƯNG describe 2 (3 test "kết hợp phạt muộn+sớm cùng ngày,
      dùng tier thật từ DB") CHƯA có bản mirror nào — đã port nguyên 3 test này sang file mới
      `__tests__/modules/timesheet/late-early-combined.test.ts` (dùng `buildLatePenaltyResolver`/
      `buildEarlyPenaltyResolver` từ `modules/timesheet` + `resolveAttendanceDay` domain), verify cả 3
      pass trước khi xoá file cũ.

      **Bug tiềm ẩn phát hiện + fix trong lúc xoá (KHÔNG phải do lần xoá này gây ra, mà bị lộ ra vì xoá
      1 import "vô tình" đang che nó):** `attendanceHelper.ts` (bản cũ) import
      `resolveLeaveConflictOnAttendance` từ `leaveHandler.js`, và `leaveHandler.js` lại import
      `ShiftModel` — chuỗi import này VÔ TÌNH khiến mongoose model `"shift"` luôn được đăng ký bất cứ
      khi nào có file nào đó require `attendanceHelper.ts` (vd `forgotCheckinHandler.js` require
      `normalizeDayPunches` từ đây). Khi xoá import không dùng này, lộ ra
      `WorkSheetRepository.findByUserAndDate` (modules/timesheet/infrastructure/work-sheet.repository.ts)
      gọi `.populate("shifts")` nhưng CHÍNH FILE NÀY không hề import `ShiftModel` — phụ thuộc ngầm vào
      việc model đã được đăng ký ở đâu đó khác trong toàn bộ app (luôn đúng lúc chạy thật vì mọi model
      được require ở tầng khởi động, nhưng KHÔNG đúng trong 1 test file cô lập không tình cờ import
      ShiftModel ở đâu trong chain của nó — cụ thể là `forgotCheckinApprove.test.ts`, lỗi
      `MissingSchemaError: Schema hasn't been registered for model "shift"`). Fix: thêm side-effect
      import `import "../../../models/ShiftModel";` tường minh vào `work-sheet.repository.ts` (file này
      thực sự phụ thuộc model này qua populate, nay khai báo tường minh thay vì ăn theo may rủi thứ tự
      require của caller).

      **Verify cuối:** `tsc --noEmit` sạch, `eslint` sạch trên mọi file đã đụng. Full suite chạy lặp lại
      nhiều lần ổn định ở `453 passed / 8 failed` (2 suite lỗi cũ y hệt trước giờ:
      `approvalChain.test.js`, `requestApprovalFlow.test.js` — không tăng thêm suite lỗi nào so với
      trước 1.8.3.7).

**Definition of done 1.8.3: ĐÃ ĐẠT.** `Timesheet` có module DDD đầy đủ, sở hữu `WorkSheetModel`+
`WorkDayStatusModel`, 5 entry point cutover xong, code cũ xoá sạch, gap Holiday-awareness (SRS) đã vá,
`npm test` ổn định `464 passed/8 failed` — đúng 2 suite lỗi cũ có từ trước (`approvalChain.test.js`,
`requestApprovalFlow.test.js`), không lẫn regression mới. Sẵn sàng sang 1.8.4.

### 1.8.4 — `modules/attendance/` (chi tiết đầy đủ, làm ngay)

**Khảo sát phạm vi trước khi chia task:** `AttendanceController.js` có 18 hàm. Phân loại theo đúng luật
mục 13 (workflows/ mới là nơi được import nhiều module — modules/attendance KHÔNG nên tự làm
báo cáo tổng hợp cross-model):

- **Ghi dữ liệu, thuộc Attendance, PHẢI cutover:** `checkIn` (hiện ghi thẳng `WorkSheetModel` qua
  `worksheet.save()`, VI PHẠM luật "Timesheet sở hữu toàn bộ WorkSheetModel" đã chốt ở 1.8.3),
  `checkOut` (đã cutover 1 phần ở 1.8.3 — dùng `applyLeaveConflictOverride`, nhưng phần ghi
  `check_out`/`minute_early` vẫn `worksheet.save()` trực tiếp), CRUD `AllowedWifiLocationModel` (3 hàm),
  CRUD `ShiftModel` (2 hàm: `createShift`/`getAllShifts`).
- **Excel-parsing thuần (absorb task 1.7.3 cũ):** `parseExcelToBlocks`/`parseDayRows` hiện nằm lạc chỗ
  trong `attendanceHelper.ts` (thuộc Timesheet theo vị trí file, nhưng bản chất là "đọc file máy chấm
  công" — đúng nghĩa Attendance). Chuyển vào `modules/attendance/infrastructure/`.
- **CHỦ ĐỘNG KHÔNG động tới trong 1.8.4** (đều là đọc/tổng hợp cross-model, đúng việc của `workflows/`
  ở 1.8.5, không phải của 1 module đơn lẻ): `getWorkSheet`, `getLichCong`, `getAllWorkSheets`,
  `getStats`, `getPayrollStats`/`getMyPayrollStats`/`getPayrollStatsAll` (vừa sửa Holiday-gap ở
  1.8.3.4b), `getCalendar`, `getStandardWorkUnits`, `adminEditWorksheet` (ghi `WorkSheetModel` nhưng là
  thao tác admin sửa tay hiếm gặp, không phải luồng nghiệp vụ chính — để nguyên, cutover sau nếu cần).
  `importExcel`'s phần ORCHESTRATION (build context, gọi `processAttendanceDay`) cũng giữ nguyên trong
  `AttendanceController.js` — chỉ phần PARSE Excel thô chuyển đi.

**Quyết định thiết kế — mở rộng public API của `modules/timesheet` cho `recordRawPunch`:** hiện
`RawPunchUpdate`/`recordRawPunch` chỉ nhận `check_in`/`check_out`. `checkIn`/`checkOut` (bản gốc) còn
ghi `minutes_late`/`minute_early` (tính "optimistic real-time", KHÁC bản tính đầy đủ theo tier của
`resolveAttendanceDay` — đúng như đã ghi chú ở 1.8.3: "optimistic real-time, Attendance module
territory"). Comment sẵn có trong `record-raw-punch.service.ts` đã dự đoán đúng nhu cầu này ("dùng khi
caller... check-in/check-out route ở modules/attendance sau này"). Sẽ mở rộng `RawPunchUpdate` thêm
`minutes_late?`/`minute_early?` optional — thay đổi nhỏ, không phá vỡ 2 caller hiện tại
(`forgotCheckinHandler.js` không set 2 field này).

- [x] 1.8.4.1 — `modules/attendance/domain/geofence.ts`: hàm thuần `isWithinRadius(point, center,
      radiusMeters)` (haversine, port nguyên công thức đang lặp lại y hệt ở `checkIn`+`checkOut`).
      Verify: `tsc`/`eslint` sạch, 5 test (khoảng cách=0, ~111km/độ vĩ độ, trong/ngoài phạm vi, đúng
      bằng radius = trong phạm vi khớp điều kiện gốc `distance > radius` mới báo lỗi).
- [x] 1.8.4.2 — `modules/attendance/domain/naive-punch-timing.ts`: hàm thuần tính `minutesLate`
      (check-in) / `minutesEarly` (check-out) kiểu "optimistic real-time" — port nguyên công thức đang
      lặp lại ở `checkIn`+`checkOut` (KHÔNG dùng tier phạt, chỉ so với giờ ca). Interface dùng
      `dateKey: string` (khớp quy ước `resolveAttendanceDay`), caller tự format ngày. Verify:
      `tsc`/`eslint` sạch, 6 test (đúng giờ/muộn/sớm hơn giờ ca cho cả check-in lẫn check-out, không
      âm). Full suite: `475 passed/8 failed` (tăng đúng 11 so với baseline `464/8`), đúng 2 suite lỗi
      cũ, không regression.
- [x] 1.8.4.3 — `modules/attendance/infrastructure/allowed-wifi-location.repository.ts`: bọc
      `AllowedWifiLocationModel` (`findActive`/`findBySsid`/`create`/`softDelete`).

      **Quyết định thiết kế khác convention `WorkSheetRepository`:** record trả về giữ NGUYÊN `_id`
      (ObjectId), KHÔNG remap sang `id: string` — vì 3 endpoint CRUD wifi hiện trả THẲNG document ra
      HTTP response cho frontend (`res.json({data: docs})`), đổi field sẽ vỡ contract API đang chạy
      thật. Khác `WorkSheetRecord` (chỉ dùng nội bộ, chưa từng serialize thẳng ra ngoài).

      Verify: `tsc`/`eslint` sạch. 6 test (`findActive` lọc đúng `isDeleted`+sort mới nhất trước,
      `findBySsid` tìm đúng/không thấy, `create` mặc định `radius=100`/dùng giá trị truyền vào,
      `softDelete` đánh dấu đúng + id không tồn tại trả `null`).
- [x] 1.8.4.4 — `modules/attendance/infrastructure/shift.repository.ts`: bọc `ShiftModel`
      (`findAll`/`findByName`/`create`).

      **Giữ nguyên 2 hành vi gốc dễ bị "sửa nhầm thành đúng" khi port:** (1) `findAll` (`getAllShifts`)
      KHÔNG lọc `isDeleted` — route xoá shift chưa từng tồn tại, không tự thêm filter mới; (2)
      `late_allowance_minutes` mặc định **0** khi tạo qua API (`createShift` destructure
      `= 0` từ `req.body`), ĐÈ lên default `5` của chính Mongoose schema — dễ nhầm là bug lúc đọc code
      nhưng đây là hành vi gốc, port nguyên trạng.

      Verify: `tsc`/`eslint` sạch. 4 test (`findAll` không lọc isDeleted, `findByName` tìm đúng/không
      thấy, `create` mặc định 0/dùng giá trị truyền vào). Full suite: `485 passed/8 failed` (tăng đúng
      10 so với baseline `475/8`), đúng 2 suite lỗi cũ, không regression.
- [x] 1.8.4.5 — `modules/attendance/infrastructure/excel-attendance-parser.ts`: chuyển nguyên
      `parseExcelToBlocks`/`parseDayRows` từ `attendanceHelper.ts` sang đây — port giữ nguyên hành vi
      (characterization test trước, so khớp output).

      **Bug nghiệp vụ có sẵn phát hiện qua review của người dùng, KHÔNG sửa trong task này (port nguyên
      trạng theo yêu cầu):** `parseDayRows` phân loại in/out theo VỊ TRÍ CỘT cố định (`row[2]/row[4]/
      row[6]` = ứng viên in, `row[7]/row[5]/row[3]` = ứng viên out) — khi máy chấm công chỉ có ĐÚNG 1
      lần quét trong ngày, giá trị đó có thể rơi vào đúng 1 nhóm cột dù bản chất là in hay out, không
      liên quan gì tới giờ chấm thật.

      Verify thật bằng script (`normalizeDayPunches` sau bước parse):
      - Ngày CHỈ có dữ liệu máy (không app): bug tự "chữa" nhờ nhánh reclassify-theo-giữa-ca của
        `normalizeDayPunches` (`!!checkIn !== !!checkOut` → chọn lại theo midpoint ca) — kết quả cuối
        vẫn đúng, không lộ ra ngoài.
      - Ngày VỪA có máy VỪA có app ở phía đối diện (vd máy quét sáng 08:01 bị gán nhầm vào nhóm "out",
        app lại có check-out chiều 17:31 riêng): 2 phía sau khi combine đều có giá trị → KHÔNG kích hoạt
        reclassify → giờ chấm công sáng thật bị mất hẳn (`checkIn: undefined`), chỉ còn `checkOut:
        17:31` — ngày đó sẽ bị tính `missed_clock` buổi sáng dù nhân viên đã chấm công thật.

      Xác nhận **có sẵn từ trước, không phải do port gây ra** (`git log -S` xác nhận logic cột này có từ
      commit `a18f3ae`, 2026-06-09, rất lâu trước migration). Đã hỏi người dùng — **quyết định: port
      nguyên trạng ngay bây giờ, sửa riêng sau bằng 1 task khác** (không trộn vào task "move thuần túy"
      này). Cần bàn cách phân loại đúng khi tới lúc sửa (vd ưu tiên theo giờ chấm thay vì theo cột).

      **Cutover:** `AttendanceController.js` đổi import `parseExcelToBlocks`/`parseDayRows` từ
      `helpers/attendanceHelper` sang `modules/attendance/infrastructure/excel-attendance-parser`;
      `attendanceHelper.ts` xóa 2 hàm này + import `xlsx` không còn dùng (giữ nguyên
      `normalizeDayPunches`/`correctDayStatuses`).

      **Test:** `__tests__/modules/attendance/excel-attendance-parser.test.ts` (8 test mới, chưa từng có
      unit test riêng cho 2 hàm này trước đây — chỉ được cover gián tiếp qua E2E
      `attendanceImportExcel.test.ts`): tách đúng nhiều block theo header, block cuối lấy hết phần còn
      lại, không có header → rỗng, bỏ qua dòng sai định dạng ngày, lấy đúng rawIn/rawOut theo cột, cắt
      giờ về `HH:mm`, không có ô nào khớp → null cả 2, và 1 test khoá lại đúng hành vi hiện tại của bug
      nêu trên (không phải xác nhận đúng). `attendanceImportExcel.test.ts` (E2E, consumer thật) 4/4 pass
      sau cutover. `tsc --noEmit` + `eslint` sạch trên cả 4 file đụng tới. `npm test` toàn repo: `493
      passed/8 failed` (tăng đúng 8 so với baseline `485/8`), đúng 2 suite lỗi cũ
      (`requestApprovalFlow`, `approvalChain`), không regression.
- [x] 1.8.4.6 — Mở rộng `modules/timesheet`: `RawPunchUpdate`/`recordRawPunch` nhận thêm
      `minutes_late?`/`minute_early?` optional (xem quyết định thiết kế ở trên).

      `work-sheet.repository.ts`: `RawPunchUpdate` thêm 2 field, `upsertRawPunch` ghi qua check
      `!== undefined` (không dùng truthy — `0` là giá trị hợp lệ, khác `check_in`/`check_out` dùng
      truthy vì luôn là `Date` khi có). `record-raw-punch.service.ts`: `RecordRawPunchInput` thêm
      `minutesLate?`/`minuteEarly?` (camelCase, khớp convention `checkIn`/`checkOut` sẵn có), map sang
      `minutes_late`/`minute_early` khi gọi repository. `RecordRawPunchInput` đã export sẵn qua
      `modules/timesheet/index.ts` — không cần sửa thêm. Consumer duy nhất hiện tại
      (`forgotCheckinHandler.js`) không đổi hành vi vì chưa truyền 2 field mới (optional, no-op nếu
      không dùng).

      **Test:** `work-sheet.repository.test.ts` thêm 3 case cho `upsertRawPunch` (ghi đúng cả 2 field
      khi truyền, `0` vẫn được ghi chứ không bị coi falsy/bỏ qua, không truyền thì giữ nguyên giá trị cũ
      không bị reset). 11/11 pass (8 cũ + 3 mới). `tsc --noEmit` + `eslint` sạch trên 3 file đụng tới.
      `npm test` toàn repo: `496 passed/8 failed` (tăng đúng 3 so với baseline `493/8`, 1 lần chạy ra
      `lateEarlyApprove.test.ts` fail ở `afterAll` — chạy lại riêng file đó pass 3/3, xác nhận flaky
      resource contention khi chạy nhiều `MongoMemoryReplSet` liên tiếp, không liên quan thay đổi này),
      đúng 2 suite lỗi cũ (`requestApprovalFlow`, `approvalChain`), không regression.
- [x] 1.8.4.7 — `modules/attendance/application/record-check-in.service.ts`: orchestrate wifi/geofence
      check → `getWorksheetForDay` (Timesheet) → validate ca/giờ → domain `naive-punch-timing` →
      `recordRawPunch` (Timesheet, đã mở rộng).

      Port nguyên `AttendanceController.checkIn` (chưa cutover route — đó là việc của 1.8.4.11): dùng
      `AllowedWifiLocationRepository.findBySsid` (1.8.4.3) + domain `isWithinRadius` (1.8.4.1) thay vì
      tự viết lại haversine/query Model trực tiếp; `getWorksheetForDay`/`recordRawPunch` (Timesheet)
      thay `WorkSheetModel.findOne(...).populate("shifts")` + `worksheet.save()` trực tiếp — đúng mục
      tiêu chính của task này: **checkIn không còn ghi thẳng `WorkSheetModel`**, khớp luật "Timesheet sở
      hữu toàn bộ WorkSheetModel" đã chốt ở 1.8.3. `UserInfoModel.findOne({id_account})` gọi trực tiếp
      trong service (module `user` chưa migrate) — đúng tiền lệ đã dùng ở
      `modules/request/application/create-request.service.ts`.

      Thêm `hasShiftEnded(now, dateKey, shiftEndTime)` vào `domain/naive-punch-timing.ts` (dùng chung
      `toMomentOnDate` nội bộ đã có) — port guard "quá giờ làm việc, không thể check-in" của bản gốc,
      tách riêng khỏi `calculateMinutesLate`/`calculateMinutesEarly` vì đây là kiểm tra boolean (đã qua
      giờ hay chưa), không phải phép đo phút.

      **Đơn giản hóa có chủ đích (không phải bug, không đổi hành vi quan sát được):** bỏ nhánh gốc "nếu
      `firstShift`/`lastShift` là ObjectId/string thì tự `ShiftModel.findById` lại" — nhánh này tồn tại
      để phòng `.populate("shifts")` không resolve được, nhưng `WorkSheetRepository.findByUserAndDate`
      (đã verify từ 1.8.3.3) luôn trả `shifts` đã là `ShiftInfo{start_time,end_time}` thuần qua populate
      + mapper, không bao giờ còn ObjectId/string lọt ra ngoài — nhánh phòng thủ trở thành dead code khi
      đi qua abstraction mới, an toàn để bỏ.

      **Mọi lỗi validate đều `ArgumentInvalidException` (400)** — khớp nguyên vẹn hành vi gốc (tất cả
      nhánh lỗi của `checkIn`, kể cả "đã check-in rồi"/"quá giờ làm việc", đều là 400, không có
      403/404/409 nào) — không tự nâng cấp sang exception ngữ nghĩa hơn vì đây là task orchestrate
      thuần, không phải đổi hành vi API.

      **Test:** `naive-punch-timing.test.ts` thêm 3 case cho `hasShiftEnded` (trước/đúng/sau giờ tan ca
      — đúng giờ tan ca vẫn là `false` vì dùng `isAfter`, không tính bằng). `record-check-in.service.test.ts`
      (mới, `MongoMemoryServer` — không cần replset vì không có transaction): 10 case — 7 nhánh lỗi
      (thiếu input, SSID sai, ngoài bán kính, thiếu userInfo, thiếu worksheet, đã check-in rồi, thiếu
      shift, quá giờ làm việc) + 3 happy-path (đúng giờ `minutesLate=0`, muộn 20 phút ghi đúng, verify
      cả giá trị trả về lẫn dữ liệu ghi thật trong `WorkSheetModel`). Dùng `jest.useFakeTimers()` +
      `jest.setSystemTime()` để kiểm soát "giờ hiện tại" xác định (đúng pattern đã dùng ở
      `attendanceCheckOut.test.ts`). Tổng 13 test mới, tất cả pass. `tsc --noEmit` + `eslint` sạch trên
      cả 4 file đụng tới. `npm test` toàn repo: `509 passed/8 failed` (tăng đúng 13 so với baseline
      `496/8`), đúng 2 suite lỗi cũ (`requestApprovalFlow`, `approvalChain`), không regression.

      **Chưa cutover:** `AttendanceController.checkIn` vẫn dùng logic inline cũ — service này CHƯA được
      gọi ở đâu, chờ 1.8.4.11.
- [x] 1.8.4.8 — `modules/attendance/application/record-check-out.service.ts`: tương tự, cộng thêm gọi
      `applyLeaveConflictOverride` (Timesheet) + `adjustLeaveBalance` (Leave) — GIỮ NGUYÊN kiểu gọi
      trực tiếp cross-module tạm thời như hiện tại (đã chấp nhận ở 1.8.3, chờ `workflows/` ở 1.8.5 dọn
      lại đúng chuẩn, không phải fork mới cần hỏi).

      **Phát hiện thêm ngoài danh sách liệt kê ban đầu của task (chỉ ghi "applyLeaveConflictOverride +
      adjustLeaveBalance"):** đọc kỹ `AttendanceController.checkOut` thấy còn bước thứ 4 —
      `WorkDayStatusModel.updateMany({status:"pending"} -> "present")` sau check-out, KHÔNG liên quan gì
      leave conflict (attendance-driven status, khác hẳn nhánh leave-conflict decision-driven). Theo
      luật "1 owner cho WorkDayStatus" (mục 13), bước này phải sống ở Timesheet — đã thêm
      `WorkDayStatusRepository.markPendingAsPresent(worksheetId, session)` (repository, port nguyên
      `updateMany` gốc) + `application/mark-attendance-present.service.ts` (`markAttendancePresent`,
      thin wrapper) + export qua `modules/timesheet/index.ts`. Không phải fork cần hỏi — hệ quả trực
      tiếp của luật đã chốt, giống cách `record-raw-punch`/`applyLeaveConflictOverride` đã làm.

      **`record-check-out.service.ts`:** port nguyên `AttendanceController.checkOut` — wifi/geofence →
      userInfo → worksheet (đọc NGOÀI transaction, khớp bản gốc) → validate → tính `minuteEarly` qua
      `calculateMinutesEarly` (1.8.4.2) → `runInTransaction` (core/db, Phase 0) bọc đúng thứ tự gốc:
      `recordRawPunch` (ghi check_out/minute_early qua Timesheet, thay `worksheet.save({session})` trực
      tiếp — mục tiêu chính của 1.8.4.7/1.8.4.8: check-out không còn ghi thẳng `WorkSheetModel`) →
      `applyLeaveConflictOverride` → `adjustLeaveBalance` nếu `leaveRefundAmount > 0` →
      `markAttendancePresent`. Dùng `runInTransaction` thay vì tự quản
      `mongoose.startSession()/startTransaction()` thủ công như bản gốc — cùng cơ chế `modules/request`
      đã dùng từ task 1.10, tự map `TransientTransactionError` → `ConflictException` (409) thay vì để lộ
      `MongoServerError`/500 thô như bản gốc (bản gốc catch-all mọi lỗi thành 500).

      Mọi lỗi validate đều `ArgumentInvalidException` (400) — cùng lý do đã ghi ở
      `record-check-in.service.ts` (1.8.4.7): khớp nguyên vẹn hành vi gốc, không tự nâng cấp ngữ nghĩa.

      **Test:** `work-day-status.repository.test.ts` thêm 4 case cho `markPendingAsPresent` (flip đúng
      status pending + gắn source, không đụng status khác của cùng worksheet, không đụng doc worksheet
      khác, không có gì thì không lỗi). `record-check-out.service.test.ts` (mới, `MongoMemoryReplSet` —
      cần thật vì có transaction): 11 case — 7 nhánh lỗi (thiếu input, SSID sai, ngoài bán kính, thiếu
      userInfo, thiếu worksheet, đã check-out rồi, thiếu shift) + 4 happy-path (đúng giờ `minuteEarly=0`
      không tạo ledger, sớm 20 phút ghi đúng, che phủ `leave_paid` buổi chiều → flip present + hoàn 0.5
      phép — port nguyên 2 case đã có ở `attendanceCheckOut.test.ts`, và case mới cho
      `markAttendancePresent` — flip status `pending` không liên quan leave thành `present`). Tổng 15
      test mới, tất cả pass. `tsc --noEmit` + `eslint` sạch trên cả 5 file đụng tới. `npm test` toàn
      repo: `524 passed/8 failed` (tăng đúng 15 so với baseline `509/8`), đúng 2 suite lỗi cũ
      (`requestApprovalFlow`, `approvalChain`), không regression.

      **Chưa cutover:** `AttendanceController.checkOut` vẫn dùng logic inline cũ (kể cả
      `applyLeaveConflictOverride`/`adjustLeaveBalance` gọi trực tiếp, không qua service mới) — chờ
      1.8.4.11.
- [x] 1.8.4.9 — `modules/attendance/application/manage-wifi-location.service.ts` +
      `manage-shift.service.ts`: CRUD mỏng bọc 2 repository ở 1.8.4.3/1.8.4.4.

      Port nguyên 5 hàm controller: `listAllowedWifiLocations`/`createAllowedWifiLocation`/
      `deleteAllowedWifiLocation` (wifi), `listShifts`/`createShift` (shift). Lỗi validate/trùng đều
      `ArgumentInvalidException` (400) — khớp nguyên vẹn hành vi gốc (không nâng cấp 409 dù về ngữ nghĩa
      "đã tồn tại" hợp lý hơn là Conflict — cùng lý do đã áp dụng ở 1.8.4.7/1.8.4.8: task orchestrate
      thuần, không đổi hành vi API). Riêng lỗi "không tìm thấy" khi xoá dùng `NotFoundException` (404) —
      TRÙNG khớp status code gốc sẵn có (không phải nâng cấp, tình cờ đã đúng từ trước).

      **Test:** `manage-wifi-location.service.test.ts` (mới, `MongoMemoryServer`): 7 case (list chỉ lấy
      active, thiếu input, SSID trùng, tạo thành công dùng default radius=100/radius truyền vào, xoá
      không tồn tại throw 404, xoá thành công soft-delete + biến mất khỏi list).
      `manage-shift.service.test.ts` (mới): 5 case (list trả tất cả, thiếu input, tên trùng, tạo thành
      công default `late_allowance_minutes=0`/giá trị truyền vào). Tổng 12 test mới, tất cả pass. `tsc
      --noEmit` + `eslint` sạch trên cả 4 file đụng tới. `npm test` toàn repo: `536 passed/8 failed`
      (tăng đúng 12 so với baseline `524/8`), đúng 2 suite lỗi cũ, không regression.

      **Chưa cutover:** `AttendanceController`'s 5 hàm CRUD vẫn dùng logic inline cũ — chờ 1.8.4.11.
- [x] 1.8.4.10 — `modules/attendance/index.ts`: public API (`recordCheckIn`, `recordCheckOut`, CRUD
      wifi/shift, `parseExcelToBlocks`/`parseDayRows`... liệt kê cụ thể khi tới lượt).

      Export: `recordCheckIn`/`recordCheckOut` + type input/result; `listAllowedWifiLocations`/
      `createAllowedWifiLocation`/`deleteAllowedWifiLocation` + `AllowedWifiLocationRecord`/
      `CreateAllowedWifiLocationInput`/`CreateAllowedWifiLocationServiceInput`; `listShifts`/
      `createShift` + `ShiftRecord`/`CreateShiftServiceInput`; `parseExcelToBlocks`/`parseDayRows`
      (đúng liệt kê ban đầu của task — infra-level parsing function, khác domain logic, không cần
      encapsulate). KHÔNG export `AllowedWifiLocationRepository`/`ShiftRepository`/domain function
      (`isWithinRadius`/`calculateMinutesLate`/`calculateMinutesEarly`/`hasShiftEnded`) — đúng luật #2
      (mục 13), chưa có consumer ngoài module cần tới.

      **Test:** `index.test.ts` (mới) — 4 case qua public API (không import path nội bộ): kiểm tra
      `recordCheckIn`/`recordCheckOut` là hàm (2 hàm này đã có test riêng đầy đủ ở 1.8.4.7/1.8.4.8, không
      lặp lại behavior test ở đây), CRUD wifi tạo→list→xoá→biến mất, CRUD shift tạo→xuất hiện trong
      list, `parseExcelToBlocks`+`parseDayRows` parse đúng qua public API. Verify encapsulation bằng
      `@ts-expect-error` cố tình import `AllowedWifiLocationRepository` — biên dịch báo lỗi đúng như kỳ
      vọng (đúng pattern đã dùng ở `modules/timesheet/index.ts`, 1.8.3.5).

      **Sự cố nhỏ tự phát hiện + sửa khi viết chính test này:** comment giải thích tiếng Việt phía trên
      dòng `@ts-expect-error` vô tình chứa CHÍNH literal chuỗi `@ts-expect-error` — TypeScript quét toàn
      bộ comment trong file tìm literal string này để nhận diện directive, hiểu nhầm dòng comment giải
      thích cũng là 1 directive nhắm vào dòng kế tiếp (không có lỗi) → báo "unused '@ts-expect-error'
      directive" sai chỗ, che mất việc directive thật (dòng ngay trên import) có hoạt động đúng hay
      không. Sửa bằng cách đổi chữ trong comment giải thích (bỏ ký tự `@` khỏi cụm từ nhắc tới) để không
      còn trùng literal. Bài học: không nhắc tên chính xác 1 comment-directive trong prose-comment cùng
      file, dùng cách diễn đạt khác đi.

      `tsc --noEmit` + `eslint` sạch trên cả 2 file. `npm test` toàn repo: `540 passed/8 failed` (tăng
      đúng 4 so với baseline `536/8`), đúng 2 suite lỗi cũ, không regression.
- [x] 1.8.4.11 — Cutover `AttendanceController.js`: `checkIn`/`checkOut`/3 hàm wifi/2 hàm shift gọi qua
      `modules/attendance` thay vì logic inline; `importExcel` đổi sang parser mới ở 1.8.4.5 (giữ
      nguyên phần orchestration). Route `src/routes/attendance.js` KHÔNG đổi (giữ nguyên path/middleware
      RBAC, chỉ đổi bên trong handler).

      **7 handler cutover:** `checkIn`/`checkOut` giờ chỉ gọi `recordCheckIn`/`recordCheckOut` rồi map
      kết quả sang response JSON (giữ nguyên field `check_in`/`minutes_late`/`check_out`/`minute_early`)
      — `checkOut` không còn tự quản `mongoose.startSession()/startTransaction()/commitTransaction()`
      thủ công (đã chuyển vào `recordCheckOut` qua `runInTransaction` từ 1.8.4.8), controller chỉ còn
      `try/catch` đơn giản. `getAllowedWifiLocations`/`createAllowedWifiLocation`/
      `deleteAllowedWifiLocation`/`createShift`/`getAllShifts` gọi thẳng service tương ứng ở
      `modules/attendance` (1.8.4.9). `importExcel`'s import `parseExcelToBlocks`/`parseDayRows` đổi từ
      path nội bộ (`modules/attendance/infrastructure/excel-attendance-parser`, tạm dùng từ 1.8.4.5 vì
      lúc đó chưa có `index.ts`) sang qua public API `modules/attendance` (index.ts vừa có từ 1.8.4.10)
      — đúng ranh giới Hexagonal, không đổi hành vi.

      **Dùng chung `sendExceptionResponse`** (`core/http/handle-exception.ts`, có sẵn từ task 1.6) cho
      cả 7 handler thay vì mỗi handler tự `console.error` + viết tay `res.status(...).json(...)` — mọi
      lỗi 400/404 (từ `ArgumentInvalidException`/`NotFoundException` các service mới ném ra) tự map
      đúng `{statusCode, message}`; lỗi lạ vẫn rơi vào nhánh `500 {message: "Lỗi server", error}`.
      **1 khác biệt cosmetic rất nhỏ, chấp nhận được:** 3 handler wifi bản gốc dùng message lỗi 500
      `"Lỗi server."` (có dấu chấm) trong khi `sendExceptionResponse` dùng `"Lỗi server"` (không dấu
      chấm, khớp 4 handler còn lại) — không phải business rule, chỉ là text lỗi chung chung không ai
      assert; dùng chung 1 helper thay vì giữ 2 biến thể message cho cùng 1 ý nghĩa.

      **Dọn import không còn dùng:** xoá hẳn `AllowedWifiLocationModel`/`ShiftModel` (2 model) +
      `applyLeaveConflictOverride`/`adjustLeaveBalance`/`LEAVE_BALANCE_REASON` (chỉ `checkOut` dùng, giờ
      nằm trong `recordCheckOut`) khỏi import — giữ nguyên `getLeaveBalance`/`PERMISSION`/`mongoose`
      (vẫn dùng ở các handler khác chưa migrate, đã grep xác nhận).

      **Test:** `__tests__/attendanceCheckIn.test.ts` (mới — `checkIn` chưa từng có test qua controller
      thật trước đây): 2 case (thành công ghi đúng `WorkSheetModel` + response, lỗi SSID sai trả đúng
      400 qua `sendExceptionResponse`). `__tests__/attendanceWifiShiftCrud.test.ts` (mới — 5 hàm CRUD
      chưa từng có test qua controller thật): 8 case (list/tạo/tạo trùng lỗi 400/xoá không tồn tại lỗi
      404/xoá thành công cho wifi; tạo trùng lỗi 400/tạo thành công 201/list cho shift). Cả 2 file chỉ
      verify phần WIRING (Express req/res thật + `sendExceptionResponse` map đúng status/message) — logic
      nghiệp vụ đã test đầy đủ ở service test riêng (1.8.4.7/1.8.4.8/1.8.4.9), không lặp lại. Chạy lại
      `attendanceCheckOut.test.ts`/`attendanceImportExcel.test.ts` (test cũ, dùng
      `AttendanceController.checkOut`/`.importExcel` trực tiếp) — 6/6 pass, xác nhận cutover không phá
      vỡ 2 file test đã có từ trước.

      Tổng 10 test mới. `node --check` + `eslint` sạch trên `AttendanceController.js`. `npm run build`
      thành công (xác nhận `tsc` biên dịch đúng khi `.js` (`allowJs`) require named export từ
      `modules/attendance` — module TS mới). `npm test` toàn repo: `550 passed/8 failed` (tăng đúng 10 so
      với baseline `540/8`), đúng 2 suite lỗi cũ (`requestApprovalFlow`, `approvalChain`), không
      regression.
- [x] 1.8.4.12 — Xoá code cũ: `checkIn`/`checkOut` logic inline cũ, `parseExcelToBlocks`/`parseDayRows`
      khỏi `attendanceHelper.ts`, CRUD wifi/shift cũ — sau khi cutover xanh (đúng khuôn đã dùng ở
      1.8.3.7: grep xác nhận hết call site trước khi xoá).

      **Khác 1.8.3.7 — không có gì để xoá thêm, đã xong từ trước:** task này giả định khuôn "cutover
      trước (giữ code cũ song song), xoá riêng ở task sau" như 1.8.3.7. Thực tế 1.8.4.5 (xoá
      `parseExcelToBlocks`/`parseDayRows` khỏi `attendanceHelper.ts`) và 1.8.4.11 (cutover 7 handler)
      đều làm theo kiểu **thay thế trực tiếp** (Edit ghi đè nguyên khối code cũ bằng code mới trong cùng
      1 lần sửa), không viết code mới cạnh code cũ rồi tính xoá sau — nên không còn code chết nào sót
      lại để dọn ở bước riêng này.

      **Verify kỹ trước khi kết luận "không có gì làm" (không suy đoán):** grep toàn repo xác nhận —
      không còn `AllowedWifiLocationModel`/`ShiftModel` nào trong `AttendanceController.js`; không còn
      `parseExcelToBlocks`/`parseDayRows` trong `attendanceHelper.ts`; không còn công thức haversine
      (`6371000`) nào ngoài `modules/attendance/domain/geofence.ts`; không còn logic tính
      `minutes_late`/`minute_early` kiểu cũ (`Math.max(0, Math.floor(...))`) lặp lại ở đâu khác;
      `src/routes/attendance.js` chỉ tham chiếu `AttendanceController.<handler>` qua property access,
      không đổi gì (đúng yêu cầu). 2 chỗ còn dùng `ShiftModel` trực tiếp
      (`helpers/leaveHandler.js`/`helpers/awayDayHandler.js`, dòng tìm `"Ca hành chính"`/`"Ca sáng"` mặc
      định khi duyệt đơn nghỉ/remote) — xác nhận đây là nghiệp vụ RIÊNG của module `request` (gán ca mặc
      định lúc duyệt đơn), không liên quan/không trùng lặp check-in/check-out, không thuộc phạm vi dọn
      dẹp task này.

      `npm test` toàn repo chạy lại xác nhận ổn định `550 passed/8 failed`, không đổi so với sau
      1.8.4.11 (đúng dự kiến vì không có code nào bị đụng thêm).

**Definition of done 1.8.4 — ĐÃ ĐẠT:** `modules/attendance` sở hữu `AllowedWifiLocationModel`+
`ShiftModel`, checkIn/checkOut không còn ghi thẳng `WorkSheetModel` (đi qua `modules/timesheet` public
API), Excel-parsing tách khỏi `attendanceHelper.ts`, `AttendanceController.js` (7 handler) cutover xong
qua `modules/attendance`, `npm test` ổn định `550 passed/8 failed` — đúng 2 suite lỗi cũ
(`requestApprovalFlow`, `approvalChain`), không lẫn regression mới. Sẵn sàng sang 1.8.5.

### 1.8.5 — `workflows/` (chi tiết đầy đủ, làm ngay)

**Phát hiện quan trọng khi bắt đầu chi tiết hoá (đọc lại rule #1 mục 13 đối chiếu code thật đã viết ở
1.8.4):** `modules/attendance/application/record-check-in.service.ts`/`record-check-out.service.ts`
(1.8.4.7/1.8.4.8) hiện đang `import` thẳng `modules/timesheet` (`getWorksheetForDay`/`recordRawPunch`/
`applyLeaveConflictOverride`/`markAttendancePresent`) và `modules/leave` (`adjustLeaveBalance`) — **vi
phạm đúng rule #1** ("`modules/x` chỉ import `core/`, `shared-kernel/`, và chính nó — KHÔNG import
`modules/y`"), dù đã ghi rõ ở 1.8.4.7/1.8.4.8 là "chấp nhận tạm thời, chờ `workflows/` dọn lại". Đây
chính là việc "dọn lại" đó — **không phải fork mới cần hỏi**, đã có quyết định sẵn từ trước, chỉ là lúc
này mới thực thi.

**Quyết định phạm vi (thu hẹp so với bảng tóm tắt gốc ở mục 14 — refine sau khi có code thật, đúng tinh
thần "chi tiết hoá khi bắt đầu, không lập kế hoạch cho thứ chưa rõ"):**
- **Làm ngay trong 1.8.5:** `record-check-in.workflow.ts`, `record-check-out.workflow.ts` (tách 2 file
  riêng thay vì gộp 1 "record-checkout" như bảng gốc — khớp đúng cách `modules/attendance/application/`
  đã tách 2 use-case riêng từ 1.8.4.7/1.8.4.8, không có lý do gộp lại).
- **`import-attendance.workflow.ts` — dời xuống cuối 1.8.5 (1.8.5.5), thiết kế khi tới lượt:** hiện
  `AttendanceController.importExcel`/`jobs/finalizeWorkDay.js` (2 file NGOÀI `src/modules/`, thuộc tầng
  composition-root — KHÔNG vi phạm rule #1 vì rule đó chỉ áp cho code SỐNG BÊN TRONG `src/modules/`)
  đã tự do phối hợp `modules/timesheet` + `RequestModel` trực tiếp, phức tạp hơn nhiều record-check-in/
  out (context 7-query, chưa rõ ranh giới tách). Xây nền bằng 2 workflow đơn giản trước để có mẫu, rồi
  quay lại thiết kế cái khó nhất.
- **`review-request.workflow.ts`/`cancel-request.workflow.ts` — DỜI HẲN sang 1.8.6** (không làm ở
  1.8.5, kể cả file rỗng/stub): 2 workflow này cần tách 7 handler `helpers/*Handler.js` (`onCreate`/
  `onApprove`/`onReject`) làm trước — đúng theo bảng gốc mục 14 đã ghi rõ đây là việc của 1.8.6. Viết
  trước khi tách handler chỉ tạo ra bản nháp chắc chắn phải viết lại, không có giá trị.

**Rule #1 áp dụng lại cho `modules/attendance` sau khi tách:** giữ đúng
`AllowedWifiLocationRepository`/`ShiftRepository`/CRUD service (wifi/shift) + `parseExcelToBlocks`/
`parseDayRows` + domain (`geofence.ts`/`naive-punch-timing.ts`) — đây là phần THUẦN thuộc Attendance,
không cần Timesheet/Leave. `record-check-in.service.ts`/`record-check-out.service.ts` (2 file vi phạm
rule #1) sẽ bị xoá hẳn khỏi `modules/attendance/`, logic chuyển nguyên sang `workflows/`.

- [x] 1.8.5.1 — `modules/attendance`: tách phần validate wifi/geofence dùng chung giữa check-in/
      check-out thành 1 hàm riêng `application/check-wifi-location.service.ts`
      (`checkWifiLocation({ssid, latitude, longitude})`, throw `ArgumentInvalidException` nếu sai SSID/
      ngoài bán kính) — hiện đang lặp y hệt ở cả 2 service sắp bị xoá, tách ra để `workflows/` dùng
      chung thay vì copy-paste 2 lần. Export thêm domain function
      (`calculateMinutesLate`/`calculateMinutesEarly`/`hasShiftEnded`) qua `index.ts` — trước đây
      KHÔNG export (chỉ dùng nội bộ 2 service sắp xoá), giờ `workflows/` cần gọi trực tiếp.

      **Test:** `check-wifi-location.service.test.ts` (mới, 4 case: thiếu input, SSID sai, ngoài bán
      kính, hợp lệ không throw). `tsc --noEmit` + `eslint` sạch. `npm test` toàn repo: `554 passed/8
      failed` (tăng đúng 4 so với baseline `550/8`), đúng 2 suite lỗi cũ, không regression.
- [x] 1.8.5.2 — `src/workflows/record-check-in.workflow.ts`: chuyển nguyên orchestration từ
      `record-check-in.service.ts` (userInfo lookup → `checkWifiLocation` (attendance) →
      `getWorksheetForDay` (timesheet) → validate business rule (đã check-in/không có shift/quá giờ,
      dùng `hasShiftEnded` từ attendance) → `calculateMinutesLate` (attendance) → `recordRawPunch`
      (timesheet)) — port nguyên logic, chỉ đổi từ 1 file trong `modules/attendance/application/` sang
      `src/workflows/`, không đổi hành vi. `tsc --noEmit` + `eslint` sạch.
- [x] 1.8.5.3 — `src/workflows/record-check-out.workflow.ts`: tương tự, cộng `applyLeaveConflictOverride`
      + `adjustLeaveBalance` (nếu refund > 0) + `markAttendancePresent` — chuyển nguyên từ
      `record-check-out.service.ts`, dùng lại `runInTransaction` y hệt. `tsc --noEmit` + `eslint` sạch.
- [x] 1.8.5.4 — Cutover: `AttendanceController.js`'s `checkIn`/`checkOut` đổi import từ
      `../modules/attendance` sang `../workflows/record-check-in.workflow`/`record-check-out.workflow`.
      Xoá `record-check-in.service.ts`/`record-check-out.service.ts` khỏi `modules/attendance/` (đã
      grep xác nhận trước khi xoá — chỉ 2 file test + `index.ts`/controller từng dùng, không consumer
      nào khác) + bỏ export tương ứng khỏi `modules/attendance/index.ts`. Chuyển 2 file test tương ứng
      sang `__tests__/workflows/record-check-in.workflow.test.ts`/`record-check-out.workflow.test.ts`
      (đổi import path, port nguyên assertion không sửa 1 dòng). Cập nhật
      `__tests__/modules/attendance/index.test.ts` (bỏ `recordCheckIn`/`recordCheckOut` khỏi phần verify
      public API, thêm verify `checkWifiLocation` + 3 domain function mới export ở 1.8.5.1).

      **Verify rule #1 bằng grep (không suy đoán):** `modules/attendance/` không còn import
      `modules/timesheet`/`modules/leave` ở bất kỳ file nào (1 match giả ở comment giải thích trong
      `naive-punch-timing.ts`, không phải import thật — đã kiểm tra riêng). `npm run build` thành công
      (xác nhận `AttendanceController.js` — `.js`, `allowJs` — require đúng named export từ
      `src/workflows/*.workflow.ts` mới). Chạy lại `attendanceCheckIn.test.ts`/
      `attendanceCheckOut.test.ts`/`attendanceWifiShiftCrud.test.ts`/`attendanceImportExcel.test.ts`
      (test E2E qua `AttendanceController` thật, viết từ 1.8.4.11) — 89/89 pass, xác nhận cutover qua
      `workflows/` không đổi hành vi quan sát được qua HTTP-shaped controller.

      `npm test` toàn repo: `554 passed/8 failed` (không đổi so với sau 1.8.5.1 — 2 file test bị xoá và
      2 file mới có ĐÚNG số test y hệt, chỉ đổi vị trí/import, không mất/thêm coverage), đúng 2 suite lỗi
      cũ (`requestApprovalFlow`, `approvalChain`), không regression.
- [x] 1.8.5.5 — `src/workflows/import-attendance.workflow.ts` — khảo sát kỹ trước khi code (đọc từng
      field của cả 2 bản, không suy đoán): `jobs/finalizeWorkDay.js`'s `buildUserDayContext` (phạm vi
      đúng 1 ngày — `todayStart/todayEnd`) và `AttendanceController.importExcel`'s context xây inline
      (phạm vi nhiều ngày trong 1 block Excel — `rangeStart/rangeEnd`) **giống nhau ở 5/6 query, chỉ
      khác đúng 1 chỗ:** `importExcel` merge thêm dữ liệu máy chấm công thô (`excelRawMap`) vào bước xây
      `daySnapshots` (dùng cho `forgotOccurrenceMap`), `buildUserDayContext` không có nguồn này. Tách
      generic hoá được — tham số `excelRawByDate?` (mặc định rỗng) khi rỗng thì `daySnapshots` chỉ còn
      duyệt worksheet (giống hệt bản gốc của cron).

      **Phát hiện thêm khi grep tìm consumer:** ngoài 2 chỗ đã biết, `helpers/forgotCheckinHandler.js`
      và `helpers/lateEarlyHandler.js` (`onApprove`) cũng gọi `buildUserDayContext` (qua
      `require("../jobs/finalizeWorkDay")`) — tổng cộng **4 chỗ dùng logic này** (3 gọi hàm chung + 1
      bản trùng lặp inline), không phải 2 như khảo sát sơ bộ ban đầu.

      **Thiết kế:** `buildAttendanceContext({userId, rangeStart, rangeEnd, periodStart, periodEnd,
      excelRawByDate?, session?})` — hàm DUY NHẤT chứa 6 query (`WorkSheetModel`/`RequestModel`/
      `WorkDayStatusModel`) + toàn bộ logic build map/set, sống ở `workflows/`. Cutover cả 4 chỗ:
      - `jobs/finalizeWorkDay.js`: `buildUserDayContext` (tên/signature cũ giữ nguyên, vẫn export) giờ
        chỉ là wrapper mỏng gọi `buildAttendanceContext` — nhờ giữ nguyên tên/tham số, **2 consumer khác
        (`forgotCheckinHandler.js`/`lateEarlyHandler.js`) không cần sửa gì** (vẫn `require("../jobs/
        finalizeWorkDay")` như cũ).
      - `AttendanceController.importExcel`: xoá ~90 dòng context-builder trùng lặp, thay bằng gọi
        `buildAttendanceContext` (kèm `excelRawByDate`) song song với query `worksheets` riêng (query
        này KHÔNG chung với cron — có `.populate("shifts")`, dùng cho vòng lặp per-day của importExcel,
        không thuộc phạm vi hàm dùng chung).

      **Cố tình CHƯA đi qua repository của Timesheet/Request cho các query trong `buildAttendanceContext`**
      (rule #3 mục 13 lý tưởng đòi mỗi model có đúng 1 owner-repository) — quyết định phạm vi có chủ
      đích: đây là hàm BÁO CÁO/BATCH-CONTEXT (đọc thuần), đã sống trực tiếp ở tầng composition-root
      (`jobs/`, `controllers/`) từ trước khi có `workflows/` — chuyển vào đây KHÔNG phải regression (cùng
      mức "truy cập trực tiếp" như hiện trạng, chỉ gộp 4 bản trùng lặp thành 1). Thêm repository
      read-method riêng cho các query báo cáo này (vd `WorkSheetRepository.findManyInRange`,
      `RequestRepository` tương ứng) là cải thiện tách biệt, ngoài phạm vi "gộp trùng lặp" của task này —
      ghi backlog cho lần sau.

      **Test:** `import-attendance.workflow.test.ts` (mới) — 3 case: **differential test** so trực tiếp
      `buildAttendanceContext` (excelRawByDate rỗng) với `buildUserDayContext` gốc trên CÙNG 1 input
      (cùng seed DB, cùng tham số) — xác nhận identical, không suy đoán; 1 case cả 2 rỗng dữ liệu; 1 case
      xác nhận `excelRawByDate` hoạt động đúng (ngày chỉ có dữ liệu máy, không worksheet, vẫn lọt vào
      `forgotOccurrenceMap` — đúng hành vi importExcel cũ). Chạy lại `finalizeWorkDay.test.ts` (4/4),
      `forgotCheckinApprove.test.ts` + `lateEarlyApprove.test.ts` (8/8), `attendanceImportExcel.test.ts`
      (4/4) — toàn bộ pass không sửa 1 dòng test nào, xác nhận cutover cả 4 chỗ không đổi hành vi.

      `tsc --noEmit` + `eslint` sạch trên toàn bộ file đụng tới (`import-attendance.workflow.ts`,
      `jobs/finalizeWorkDay.js`, `AttendanceController.js`). `npm run build` thành công. `npm test` toàn
      repo: `557 passed/8 failed` (tăng đúng 3 so với baseline `554/8`), đúng 2 suite lỗi cũ
      (`requestApprovalFlow`, `approvalChain`), không regression.

**Definition of done 1.8.5 — ĐÃ ĐẠT:** `modules/attendance` không còn import `modules/timesheet`/
`modules/leave` ở bất kỳ đâu (đúng rule #1, verify bằng grep); `workflows/record-check-in.workflow.ts` +
`record-check-out.workflow.ts` là nơi DUY NHẤT điều phối check-in/check-out xuyên 3 module (Attendance/
Timesheet/Leave); `workflows/import-attendance.workflow.ts` gộp đúng 4 chỗ trùng lặp context-builder
(`jobs/finalizeWorkDay.js`, `helpers/forgotCheckinHandler.js`, `helpers/lateEarlyHandler.js`,
`AttendanceController.importExcel`) về 1 nguồn duy nhất. `npm test` ổn định `557 passed/8 failed` — đúng
2 suite lỗi cũ, không giảm số pass. `review-request.workflow.ts`/`cancel-request.workflow.ts` dời sang
1.8.6 (cần tách 7 handler trước). Sẵn sàng sang 1.8.6.

### 1.8.6 — 1.8.8 (tóm tắt, chi tiết hoá khi tới lượt)

| Sub-phase | Việc chính | Lưu ý đặc biệt |
|---|---|---|
| 1.8.6 Cutover `modules/request/` | `review-request.workflow.ts`/`cancel-request.workflow.ts` (dời từ 1.8.5) + đổi `review-request.service.ts`/`create-request.service.ts`/`cancel-request.service.ts` gọi qua `workflows/` cho action ghi; 7 handler `helpers/*Handler.js` chỉ còn `validate`/`validateAsync` (thuần Request), bỏ `onCreate`/`onApprove`/`onReject` (chuyển thành bước trong workflow) | Behavior-preserving nhưng đụng nhiều nhất — cần characterization test đầy đủ cho cả 7 loại đơn trước khi cutover |
| 1.8.7 Xoá code cũ | Phần còn lại của `AttendanceController.js` liên quan check-in/out cũ | Chỉ xoá sau khi 1.8.6 xanh, characterization test xác nhận hành vi không đổi |
| 1.8.8 Hoàn thiện | `CLAUDE.md`, tổng kết Phase 1.8 | — |
