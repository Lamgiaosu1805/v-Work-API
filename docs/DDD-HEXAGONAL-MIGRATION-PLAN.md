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
        events/
          request-created.domain-event.js
          request-approved.domain-event.js
      application/                      # Application Service = 1 use-case, gọi thẳng infra/helper (không qua port)
        create-request.service.js       # gọi lại helpers/approvalChain.js, helpers/rbac.js bên trong
        review-request.service.js
        get-eligible-reviewers.service.js # đọc, không qua Entity — CQRS-lite (task 1.6)
        get-my-requests.service.js      # đọc thẳng Mongoose, KHÔNG .lean() (giữ toJSON format — task 1.7)
        get-all-requests.service.js     # getAll — task 1.8, gọi resolve-request-view-scope.js
        resolve-request-view-scope.js   # tách theo Solution B (task 1.8) — {type: all|managed}
        request-query-filters.js        # applyRequestTypeFilter/applyDateRangeFilter/buildUserNameSearchFilter
                                         # dùng chung 1.7/1.8, escape regex cho search (task 1.8)
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

  helpers/                              # GIỮ NGUYÊN VỊ TRÍ — đóng vai trò Domain Service (mục 3)
    approvalChain.js
    rbac.js
    attendanceHelper.js
    ...                                 # không di chuyển file nào trong Phase 0-8

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
- [ ] 1.9 — `getById` (đọc + enrich: `reviewed_by_profile`, `pending_reviewer`, `approvals` kèm reviewer
      profile — authorization 3 tầng: owner / `canViewAll` / (`canReview` AND trong chuỗi)).

### Action ghi (rủi ro cao hơn — characterization test trước nếu cần, mỗi task verify kỹ)

- [ ] 1.10 — `cancel` (ghi đơn giản nhất: chỉ check ownership + status, set `cancelled`).
- [ ] 1.11 — `create` (dispatch qua 7 handler theo `request_type`, transaction, gọi
      `handler.validate/validateAsync/onCreate`).
- [ ] 1.12 — `review` nhánh **1 người duyệt** (`!needsMultiApproval`): check tự duyệt, check trong
      chuỗi/`canReviewAll`, set status, gọi `handler.onApprove`/`onReject`.
- [ ] 1.13 — `review` nhánh **đa duyệt** (mở rộng từ 1.12): Redis lock trước transaction, check đã duyệt
      chưa, push vào `approvals`, đủ 2 mới set `approved` + gọi `onApprove`.

### Hoàn thiện

- [ ] 1.14 — Đăng ký event handler cho 5 domain event (thông báo — logic y hệt hiện tại, chỉ đổi chỗ
      gọi từ inline trong controller sang subscribe theo event).
- [ ] 1.15 — Xoá `RequestController.js` cũ + code chết liên quan trong `requestUtils.js`; xác nhận 3
      file test cũ (`approvalChain.test.js`, `requestApprovalFlow.test.js`,
      `requestControllerCreate.test.js`) pass không sửa.
- [ ] 1.16 — Cập nhật `CLAUDE.md` — thêm mục pattern DDD/Hexagonal, trỏ `request` làm ví dụ tham chiếu.

**Definition of done:** test cũ + mới pass, `RequestController.js` cũ không còn được require ở đâu,
`CLAUDE.md` có ví dụ tham chiếu.

## 8. Phase 2+ — Các module còn lại

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
| 8 | `attendance` | Logic phần lớn đã an toàn (helper có test) — chủ yếu di dời cấu trúc; ghi chú idempotency nếu sau này có webhook máy chấm công |

## 9. Verification (lặp lại sau mỗi task)

1. `node --check <file vừa tạo/sửa>`
2. `npm test` — số test pass tăng hoặc giữ nguyên, không giảm, không sửa test cũ để "cho pass"
3. `npm run lint` sạch trên file vừa đụng
4. `git diff` — review trước khi sang task tiếp theo, không tự commit/push

## 10. Tiến độ

- [ ] Phase 0 — Core building blocks
- [ ] Phase 1 — Pilot module `request`
- [ ] Phase 2 — `internal-file`
- [ ] Phase 3 — `user`
- [ ] Phase 4 — `department`
- [ ] Phase 5 — `weekly-report`
- [ ] Phase 6 — `chat` (quyết định phạm vi + migrate)
- [ ] Phase 7 — `post`, `labor-contract`
- [ ] Phase 8 — `attendance`
