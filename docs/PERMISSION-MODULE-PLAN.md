# Module `permission` — Kế hoạch triển khai (DDD/Hexagonal + ABAC)

Nguồn: SRS `HRM.04` (Xem danh sách vai trò) + `HRM.05` (Cấu hình phân quyền nhân viên), v1.0,
11/08/2026 + mockup "Chỉnh sửa Vai trò" (Data Scope + Field Scope theo từng permission). Module mới,
viết theo pattern DDD/Hexagonal đã áp dụng cho `src/modules/request` — xem `CLAUDE.md` mục "DDD +
Hexagonal Architecture".

Module này **thay thế hoàn toàn** cơ chế `role` / `module_access` / `dept_scope` phẳng hiện có trong
`AccountModel` + `authMiddleware.js`. Cutover (migrate account cũ, thay route cũ) là **Phase 7**, cố
tình để cuối, không chặn các phase trước.

**Quyết định kiến trúc chốt sau thảo luận:** dùng ABAC (Attribute-Based Access Control) thay vì RBAC
role-list tĩnh, vì Data Scope/Field Scope cần biểu diễn điều kiện động (quan hệ `subject ↔ resource`,
trạng thái record) chứ không chỉ danh sách role cố định. Dùng `@casl/ability` + `@casl/mongoose` làm
rule engine thay vì tự viết — lý do và trade-off xem mục 3.

---

## 0. Câu hỏi đã chốt / còn mở

- [x] ~~"Relationship"/"Workflow" trong pipeline 8 bước (BR_01 - UC2) là gì?~~ **Đã giải quyết bằng
      kiến trúc mới** — không còn là 2 bước riêng cần định nghĩa. "Quan hệ nghiệp vụ" và "trạng thái
      quy trình" giờ chỉ là điều kiện trong `conditionTree` của Data Scope Policy / Field Scope
      Policy (vd `resource.managerId == subject.userId`, `resource.status == 'approved'`). Xem mục 2.
- [x] ~~Field Scope cấu hình ở đâu?~~ **Đã có** — mockup "Chỉnh sửa Vai trò" có cột Field Scope dạng
      dropdown theo từng permission (chỉ hiện khi permission đó là loại "xem dữ liệu"). Việc trước đó
      tôi không thấy là do convert docx→txt bỏ mất ảnh nhúng, không phải SRS thiếu.
- [x] **BR_07 "lấy Data Scope rộng nhất" → đổi thành union.** **Chốt:** khi 1 nhân viên giữ ≥2 role
      cùng cấp 1 permission với Data Scope Policy khác nhau, filter cuối = **OR (union) của tất cả
      filter từ các policy đó**, không chọn ra 1 policy "đại diện rộng nhất" (vì Data Scope giờ là
      policy đặt tên, không phải enum có thứ tự tuyến tính nên không phải cặp nào cũng so sánh được).
      Đây là **deviation có chủ đích so với chữ nghĩa gốc của BR_07 trong SRS** — cần note lại khi bàn
      giao cho người viết SRS biết, giống cách `CLAUDE.md` yêu cầu ghi nhận deviation kiến trúc.
      Áp dụng trong `ability-rule-builder.service.ts` (Phase 1).
- [x] **Xóa Data Scope Policy / Field Scope Policy đang được Role dùng → chặn xóa.** **Chốt:** nếu
      `countRolesReferencing(policyCode) > 0` thì ném `PolicyInUseError`, không tự động tước khỏi Role
      như cách xử lý xóa Role (BR_04) — vì thiếu Field Scope Policy giữa chừng có thể làm lộ dữ liệu
      nhạy cảm không kiểm soát, rủi ro cao hơn nhiều so với thiếu 1 Role. Áp dụng trong
      `delete-data-scope-policy.service.ts`/`delete-field-scope-policy.service.ts` (Phase 3).
- [x] **Thứ tự rule CASL đảm bảo "Chặn" (BR_08) luôn thắng.** **Chốt:** build rule theo thứ tự cố
      định trong `ability-rule-builder.service.ts` — toàn bộ `can` (từ role, BR_06 union) build trước,
      toàn bộ `cannot` (từ override "Chặn") luôn append sau cùng trong mảng rule, tận dụng đúng cơ chế
      "rule khớp cuối cùng thắng" mặc định của CASL thay vì chống lại nó. Có unit test riêng cho case
      này (đã liệt kê ở Phase 1).
- [x] **Field Scope có áp dụng cho `update`/`delete` không?** **Chốt (không dựa vào mockup — suy từ
      bản chất action):** Field Scope chỉ có nghĩa với action có field-shaped payload/response. Thêm
      `actionKind: "READ" | "WRITE" | "STRUCTURAL"` vào `PermissionCatalog`: `READ` (`employee.view`)
      và `WRITE` (`employee.create`, `employee.update`) mới được bật `supportsFieldScope`; `STRUCTURAL`
      (`employee.delete`, `request.review`...) luôn `supportsFieldScope: false` — vì xóa/duyệt là
      quyết định nhị phân trên toàn bộ record, không có field payload/response nào để giới hạn.
      Ý nghĩa Field Scope cũng khác theo `actionKind`: `READ` → field nào **hiện trong response**
      (enforce bằng `maskFields()`, sai chỉ lộ dữ liệu); `WRITE` → field nào **được phép có trong
      payload ghi** (enforce bằng `assertAllowedFields()` — reject cứng cả request nếu payload chứa
      field lạ, không âm thầm bỏ qua, vì ghi sai nặng hơn đọc sai). Xem mục 1/3 đã cập nhật theo.
- [x] **Spike CASL — ĐÃ CHẠY trước Phase 2, có 2 phát hiện quan trọng.**
      **Xác nhận đúng:** `accessibleBy()` (Data Scope → Mongo filter, kể cả `$and`/`$or` lồng nhau),
      `permittedFieldsOf()` (Field Scope), thứ tự rule quyết định "khớp cuối cùng thắng" (đảo ngược
      thứ tự thì `can` lại thắng `cannot` — xác nhận BR_08 phụ thuộc đúng thứ tự mảng, không phải
      CASL tự ưu tiên `cannot`), nhiều role cùng permission → nhiều rule riêng (CASL tự OR đúng, khớp
      thiết kế `ability-rule-builder.service.ts`).
      **Bug 1 — `ability.can()` (check 1 document đã fetch sẵn) đánh giá SAI khi `conditions` có
      `$and`/`$or` ở top-level** (verify: matcher lõi `@ucast/mongo2js` gọi trực tiếp thì đúng, qua
      CASL thì sai — bug ở tầng gọi của CASL). `accessibleBy()` KHÔNG dính bug này.
      **Chốt kiến trúc:** không bao giờ dùng `ability.can()` để check 1 document Data Scope phức hợp
      đã fetch sẵn — luôn nhúng filter (`accessibleBy()`/`interpolate()`) thẳng vào query DB
      (`findOne({_id, ...filter})`), không fetch-rồi-check-sau. Áp dụng khi viết
      `casl-ability.factory.ts` (Phase 2).
      **Bug 2 — tiền tố `"resource."` trong `ConditionClause.left` không dùng được verbatim làm Mongo
      field key** (Mongo hiểu dấu chấm là truy cập nested field, document thật không có wrapper
      `resource` bọc ngoài `managerId`) — filter sinh ra match 0 document. **Đã sửa** trong
      `condition-compiler.service.ts`: `toMongoFieldPath()` strip tiền tố trước khi build object key,
      cập nhật lại test + thêm test regression xác nhận output không còn chứa `"resource."`.
- [x] **Bug nguy hiểm phát hiện khi phân tích "xóa Role": thứ tự thao tác làm cache không bao giờ
      invalidate.** Cache Phase 5 **không có TTL** (chỉ sống tới khi bị invalidate chủ động). Nếu
      `delete-role.service.ts` strip role khỏi mọi `EmployeePermissionProfile` **trước** rồi mới query
      "nhân viên nào đang giữ role này" để biết cache nào cần xóa, query đó luôn trả rỗng → cache của
      nhân viên bị ảnh hưởng **không bao giờ được invalidate**, họ giữ quyền của role đã xóa vô thời
      hạn. **Chốt:** application service phải query + lưu `affectedEmployeeIds` **trước** khi
      cascade-strip, truyền vào `role.markDeleted(affectedEmployeeIds)` như tham số đầu vào thuần
      (entity không tự query cross-aggregate, chỉ nhận list đã có sẵn) — event
      `RoleDeletedDomainEvent` mang theo `affectedEmployeeIds` để handler Phase 5 invalidate đúng cache.
- [x] **Cảnh báo impact trước khi xóa Role** (đã nêu từ lúc review SRS gốc, giờ mới thành task cụ
      thể) — xóa 1 role có thể tước quyền hàng chục nhân viên mà admin không biết trước con số. Thêm
      task Phase 3/4 cho query preview riêng, xem chi tiết trong Phase 3/4 bên dưới.
- [x] **Unique index + soft-delete: mã Role/Policy có tái dùng được sau khi xóa không?** Role/Policy
      dùng soft-delete (`isDeleted`, theo `BaseSchema` convention toàn dự án) — nếu Phase 2 khai unique
      index thường trên `code` (không lọc `isDeleted`), mã của 1 role/policy đã "xóa" sẽ bị khóa vĩnh
      viễn. **Chốt:** dùng `partialFilterExpression: { isDeleted: false }` cho unique index trên `code`
      của cả `RoleModel`, `DataScopePolicyModel`, `FieldScopePolicyModel` — cho phép tái dùng mã sau
      khi đã xóa.
- [x] **Xóa role/policy đã xóa rồi (double-click/retry).** **Chốt:** repository load-trước-khi-xóa
      phải trả về không tìm thấy (đã lọc `isDeleted:false`) → application service ném
      `NotFoundException` rõ ràng, không để lỗi mập mờ hoặc no-op âm thầm.
- [x] **Override (BR_08) không có scope → over-blocking/over-granting khi nhân viên có nhiều role
      cấp cùng 1 permission qua nhiều Data Scope khác nhau.** Ví dụ: nhân viên có `request.view` qua
      cả role "Nhân viên" (scope: phòng mình) lẫn role khác (scope khác). Admin set BLOCK override
      cho `request.view` vì lý do chỉ liên quan 1 phòng ban cụ thể (vd đang điều tra vi phạm) — nhưng
      `buildBlockOverrideRule` hiện sinh ra `cannot` rule KHÔNG có `conditions`, nên CASL chặn **toàn
      bộ** `request.view` của nhân viên đó, kể cả phần lẽ ra vẫn xem được qua role khác (over-blocking).
      Tương tự chiều ngược lại, ALLOW override cấp quyền không giới hạn scope (over-granting, đã note
      trong `ability-rule-builder.service.ts`).
      **Đây là giới hạn của chính BR_08 gốc** ("Chặn... bất kể đang giữ Vai trò nào" — đọc sát nghĩa là
      chặn toàn bộ permission, không phân biệt phạm vi), không phải bug so với spec hiện tại.
      **Chốt: giữ nguyên logic hiện tại cho MVP** (override luôn unscoped, đúng chữ nghĩa BR_08).
      Hướng sửa nếu sau này cần scoped override: thêm `conditionTree?: ConditionTreeProps | null` vào
      `PermissionOverrideProps` (tái dùng `ConditionTree`/`ConditionClause` đã có, không cần VO mới),
      truyền qua `ability-rule-builder.service.ts` để gắn vào `rule.conditions` khi có — nhưng việc
      này kéo theo phải có UI cho admin tự build condition khi set override ở màn HRM.05 (mockup hiện
      chỉ có toggle ALLOW/BLOCK, không có ô nhập điều kiện) — revisit trước khi build UI override ở
      Phase 4, không làm ngay trong Phase 1.
- [x] **Giới hạn hiệu năng đã biết: `list-employees-for-permission.service.ts` có 3 round-trip DB nối
      tiếp phụ thuộc nhau** (`profiles.roleIds` → `roles.grants[].permissionCode/dataScopePolicyCode`
      → `catalog/policy`) — không phải N+1 kinh điển (không lặp theo từng employee), nhưng không
      parallelize được vì tầng sau cần dữ liệu tầng trước. Gốc rễ: `PermissionGrant` dùng **string
      code** (không phải `ObjectId` ref) để trỏ tới Policy/Permission — đổi lấy việc Role không phụ
      thuộc cứng vào `_id` nội bộ của Policy, nhưng mất khả năng dùng Mongoose `populate()` xuyên tầng.
      Ở quy mô hiện tại (list phân trang ~20 nhân viên/trang) chấp nhận được, không cần sửa ngay.
      **Nếu sau này có báo cáo chậm:** hướng tối ưu hợp lý nhất là cache `PermissionCatalog`/
      `DataScopePolicy` ở tầng application (2 bảng gần như tĩnh, seed sẵn) — không đổi lại thành
      `ObjectId` ref (phá vỡ lý do thiết kế ban đầu).

---

## 1. Aggregate & entity

```
Role (aggregate root)
├── id, name, code: RoleCode, isSystemRole
└── grants: PermissionGrant[]
      { permissionCode, dataScopePolicyCode, fieldScopePolicyCode? }

EmployeePermissionProfile (aggregate root)
├── employeeId
├── roleIds: RoleId[]
└── overrides: PermissionOverride[]  { permissionCode, status: ALLOW | BLOCK }

DataScopePolicy (aggregate root)                    FieldScopePolicy (aggregate root)
├── code, entity, label, isSystemPolicy              ├── code, entity, label, isSystemPolicy
└── conditionTree: ConditionTree                     ├── fields: string[]
                                                       └── conditionTree?: ConditionTree (optional)

EntityAttributeCatalog (seed, đọc-only qua repository — KHÔNG phải aggregate có write use-case)
├── entity
├── subjectAttributes: AttributeDef[]   { path, label, type }
├── resourceAttributes: AttributeDef[]  { path, label, type }
└── fields: FieldDef[]                  { name, label }        (dùng cho Field Scope)

PermissionCatalog (seed, đọc-only)
├── code, module, name, entity
├── actionKind: "READ" | "WRITE" | "STRUCTURAL"   (READ=view, WRITE=create/update, STRUCTURAL=delete/approve/reject/cancel)
├── supportsFieldScope: boolean   (chỉ true được khi actionKind ∈ {READ, WRITE}; STRUCTURAL luôn false)
├── validDataScopePolicies: string[]              (áp dụng cho mọi actionKind — record nào được thao tác)
└── validFieldScopePolicies: string[]             (rỗng nếu actionKind = STRUCTURAL)
```

**Boundary:** `Role` và `EmployeePermissionProfile` là 2 transaction boundary riêng (giữ nguyên thiết
kế trước — UC HRM.05 chỉ đụng 1 `EmployeePermissionProfile`). `DataScopePolicy`/`FieldScopePolicy`
là 2 aggregate CRUD riêng, độc lập với Role — Role chỉ tham chiếu bằng code, không nhúng.

### Value objects

| VO | File | Mô tả |
|---|---|---|
| `RoleCode` | `domain/value-objects/role-code.vo.ts` | `^[A-Z0-9_]+$` (BR_01) |
| `PermissionGrant` | `domain/value-objects/permission-grant.vo.ts` | `{ permissionCode, dataScopePolicyCode, fieldScopePolicyCode? }` |
| `OverrideStatus` | `domain/value-objects/override-status.vo.ts` | Enum `ALLOW \| BLOCK` |
| `ConditionClause` | `domain/value-objects/condition-clause.vo.ts` | `{ left: attributePath, operator: EQ\|NE\|IN, right: Literal \| SubjectRef }` |
| `ConditionTree` | `domain/value-objects/condition-tree.vo.ts` | `{ operator: AND\|OR, clauses: (ConditionClause \| ConditionTree)[] }` |

`ConditionClause`/`ConditionTree` là **input do admin build qua UI dạng form** (không phải JSON tự
do) — validate `left`/`right.path` phải nằm trong `EntityAttributeCatalog` của đúng `entity`, và
`operator` chỉ nhận enum cố định do mình định nghĩa (không nhận Mongo operator string trực tiếp từ
client — tránh injection).

### Domain errors

`domain/permission.errors.ts`: `DuplicateRoleCodeError` (BR_03), `SystemRoleNotDeletableError`
(BR_02 — chỉ chặn xóa, Role vẫn sửa quyền bên trong được), `InvalidRoleCodeFormatError` (BR_01),
`SystemPolicyNotMutableError` (chặn cả sửa condition/fields lẫn xóa Policy hệ thống — rủi ro cao
hơn Role vì 1 Policy có thể bị nhiều Role tham chiếu, sửa âm thầm đổi hành vi tất cả),
`PolicyInUseError` (chặn xóa khi đang được Role tham chiếu), `InvalidAttributePathError` (clause
tham chiếu attribute không có trong catalog).

### Domain events

`domain/events/`: `role-deleted.domain-event.ts` (payload `{ roleCode, affectedEmployeeIds }` — bắt
buộc mang sẵn danh sách nhân viên bị ảnh hưởng, không để handler tự query sau — xem bug cache
invalidation ở mục 0), `employee-permission-updated.domain-event.ts` (`{ employeeId }`),
`data-scope-policy-changed.domain-event.ts`, `field-scope-policy-changed.domain-event.ts`
(`{ policyCode }`) — tất cả dùng để trigger invalidate cache quyền (Phase 5).

---

## 2. Domain service — compile condition & build CASL rule (thuần, không I/O)

```
domain/services/condition-compiler.service.ts
  compile(tree: ConditionTree): CompiledCondition
  // { "$or": [{ managerId: "${subject.userId}" }, { departmentId: "${subject.departmentId}" }] }
  // chỉ transform cấu trúc, KHÔNG gọi CASL, KHÔNG query DB — thuần hàm

domain/services/ability-rule-builder.service.ts
  buildRawRules(input: {
    grants: PermissionGrant[];                       // gộp từ mọi role đang giữ
    overrides: PermissionOverride[];
    dataScopePolicies: Map<code, CompiledCondition>;  // đã load + compile sẵn
    fieldScopePolicies: Map<code, { fields, condition? }>;
  }): RawCaslRule[]
  // trả mảng rule thô { action, subject, conditions?, fields?, inverted? } đúng format CASL cần,
  // thứ tự: can (từ role, BR_06 union) → cannot (từ override BLOCK, BR_08 luôn xếp cuối)
```

`AccessEvaluator` kiểu pipeline 8 bước ở thiết kế trước **bị loại bỏ** — CASL đảm nhiệm việc đánh
giá rule (`ability.can()`), domain chỉ còn trách nhiệm build đúng input cho CASL.

---

## 3. Vì sao CASL, và ranh giới CASL lo — mình lo

| Việc | Ai lo |
|---|---|
| Build "tổng quyền hiệu lực" từ nhiều role + override (BR_06, BR_08) | `createMongoAbility(rawRules)` — nhận mảng rule đã build ở domain, CASL xử lý gộp/deny-precedence **nếu ta xếp đúng thứ tự rule** (mình vẫn phải tự đảm bảo thứ tự, xem mục 0) |
| Data Scope → Mongo query filter để `Model.find()` (bắt buộc chạy ở DB, không filter bằng JS sau khi fetch — vỡ pagination/count nếu sai) | `@casl/mongoose`'s `accessibleBy(ability, action).find()` — tự convert rule thành Mongoose query |
| Field Scope (READ) → field nào hiện trên 1 doc đã fetch | `permittedFieldsOf(ability, 'read', doc)` — trả list field, dùng `pick()`, sai chỉ lộ dữ liệu |
| Field Scope (WRITE) → field nào được phép có trong payload ghi | `permittedFieldsOf(ability, 'update'/'create', doc)` + `assertAllowedFields()` tự viết — reject cứng cả request (không âm thầm bỏ field lạ) nếu payload chứa field ngoài danh sách, vì ghi sai nặng hơn đọc sai |
| So sánh field-to-field động (`ownerId === subject.userId`) | **Đã spike xác nhận (mục 0):** `condition-compiler.service.ts`'s `interpolate()` thay `"${subject.userId}"` bằng giá trị thật trước khi đưa vào `createMongoAbility` — không so 2 field động qua `$expr`, tránh được vấn đề này hoàn toàn bằng thiết kế, không cần CASL xử lý |
| Matcher đánh giá condition | CASL v7 dùng `@ucast/mongo2js` làm matcher mặc định bên trong (không phải `sift` như ghi nhầm ở bản trước) — đã verify qua spike, evaluate đúng `$and`/`$or` khi gọi trực tiếp |
| Check 1 document đã fetch sẵn có nằm trong Data Scope không | **KHÔNG dùng `ability.can()`** — bug spike xác nhận (mục 0): sai khi `conditions` có `$and`/`$or` top-level. Luôn nhúng filter vào query DB (`findOne({_id, ...toMongoQuery()})`) thay vì fetch-rồi-check |
| 5 collection schema (Role, Profile, Policy×2, AttributeCatalog) + hàm build raw rule từ đó | **Tự làm** — CASL không biết gì về domain model của mình |
| Cache Ability theo nhân viên + invalidate khi đổi role/override/policy | **Tự làm** (Phase 5) — cache **raw rules array** (JSON-serializable) trong Redis, gọi lại `createMongoAbility(cachedRules)` mỗi request (rẻ, không round-trip DB) |

**Dependency cần thêm:** `@casl/ability`, `@casl/mongoose` vào `package.json`.

---

## 4. Task breakdown

### Phase 1 — Domain (thuần, không DB/HTTP)

- [x] `domain/value-objects/`: `role-code.vo.ts`, `permission-grant.vo.ts`, `override-status.vo.ts`,
      `condition-clause.vo.ts`, `condition-tree.vo.ts`
- [x] `domain/role.entity.ts` — `create()`, `rename()`, `addGrant()`, `removeGrant()`,
      `assertDeletable()` (ném `SystemRoleNotDeletableError`), `markDeleted(affectedEmployeeIds:
      string[])` — nhận list nhân viên bị ảnh hưởng làm tham số thuần (application service tự query
      trước, entity không tự query cross-aggregate), raise `RoleDeletedDomainEvent` mang theo list này
      (xem mục 0 — bug cache invalidation)
- [x] `domain/employee-permission-profile.entity.ts` — `assignRole()`, `unassignRole()`,
      `setOverride()`, `clearOverride()`
- [x] `domain/data-scope-policy.entity.ts`, `domain/field-scope-policy.entity.ts` —
      `assertMutable()` (ném `SystemPolicyNotMutableError`, gọi từ cả `markDeleted()` lẫn
      `updateCondition()`/`update()` — khác Role, System Policy chặn cả sửa condition/fields chứ
      không chỉ chặn xóa, vì 1 Policy có thể bị nhiều Role tham chiếu cùng lúc), validate
      `conditionTree` chỉ dùng attribute path hợp lệ (nhận `AttributeCatalog` làm tham số thuần,
      không tự load); `rename()` không bị chặn (chỉ đổi label, không đổi hành vi)
- [x] `domain/permission.errors.ts`
- [x] `domain/events/*.domain-event.ts` (4 file, xem mục 1)
- [x] `domain/services/condition-compiler.service.ts` + unit test: AND/OR lồng nhau, SUBJECT_REF vs
      LITERAL, reject attribute path không hợp lệ
- [x] `domain/services/ability-rule-builder.service.ts` + unit test: union nhiều role (BR_06), override
      BLOCK luôn xếp sau cùng (BR_08), gộp Data Scope nhiều policy thành OR (mục 0 — BR_07 mới)

### Phase 2 — Infrastructure

- [x] `models/PermissionRoleModel.js`, `models/EmployeePermissionProfileModel.js`,
      `models/DataScopePolicyModel.js`, `models/FieldScopePolicyModel.js`,
      `models/EntityAttributeCatalogModel.js`, `models/PermissionCatalogModel.js` — tất cả kế thừa
      `BaseSchema`, collection snake_case (`permission_role`, `employee_permission_profile`,
      `data_scope_policy`, `field_scope_policy`, `entity_attribute_catalog`, `permission_catalog`).
      **Đặt tên `PermissionRoleModel`/collection `permission_role` (không phải `RoleModel`/`role`)** —
      hệ thống RBAC cũ (`src/helpers/rbac.js`, `src/controllers/RbacController.js`) đã có sẵn
      `src/models/RoleModel.js`/collection `role` đang chạy song song tới lúc Phase 7 cutover, đụng
      tên thật nếu dùng chung (đã phát hiện lúc code — Write đè nhầm lên file cũ, phải khôi phục lại).
      `PermissionRoleModel`/`DataScopePolicyModel`/`FieldScopePolicyModel` dùng unique index trên
      `code` với `partialFilterExpression: { isDeleted: false }` — cho phép tái dùng mã sau khi đã
      xóa (mục 0)
- [x] `infrastructure/role.repository.ts` + `.mapper.ts`
- [x] `infrastructure/employee-permission-profile.repository.ts` + `.mapper.ts`
- [x] `infrastructure/data-scope-policy.repository.ts` + `.mapper.ts` (kèm method
      `countRolesReferencing(policyCode)` phục vụ chặn xóa khi đang dùng)
- [x] `infrastructure/field-scope-policy.repository.ts` + `.mapper.ts` (tương tự)
- [x] `infrastructure/entity-attribute-catalog.repository.ts` (đọc-only)
- [x] `infrastructure/permission-catalog.repository.ts` (đọc-only)
- [x] `infrastructure/casl-ability.factory.ts` — nhận raw rules (từ domain) → gọi
      `createMongoAbility()`; helper `toMongoQuery(ability, action, subject)` wrap
      `@casl/mongoose`'s `accessibleBy`; helper `maskFields(ability, 'read', doc)` wrap
      `permittedFieldsOf` + `pick` (Field Scope READ); helper `assertAllowedFields(ability,
      'create'|'update', entity, payload)` — reject cứng nếu payload chứa field ngoài
      `permittedFieldsOf` (Field Scope WRITE). **KHÔNG** export/dùng `ability.can()` trực tiếp để
      check 1 document Data Scope phức hợp đã fetch sẵn (bug spike đã xác nhận — xem mục 0) — mọi
      check Data Scope phải qua `toMongoQuery()` nhúng vào query DB

### Phase 3 — Application

- [x] `application/list-roles.service.ts`, `create-role.service.ts`, `update-role.service.ts`.
      `createRole` tự bắt `error.code === 11000` (race condition qua unique index, không chỉ dựa
      pre-check `findByCode`) convert thành `DuplicateRoleCodeError` sạch. `updateRole` validate mọi
      `grants[].permissionCode`/`dataScopePolicyCode`/`fieldScopePolicyCode` thực sự tồn tại trong
      `PermissionCatalog`/`DataScopePolicy`/`FieldScopePolicy` trước khi lưu — tránh grant trỏ tới
      policy đã xóa/gõ sai, khiến `assignedScopeLabels` ở màn danh sách nhân viên âm thầm rỗng mà
      không phân biệt được "role không có scope" với "role trỏ tới policy chết"
- [x] `application/get-role-deletion-impact.service.ts` — query
      `countEmployeesWithRole(roleId)`/trả về danh sách preview, dùng cho UI cảnh báo "sẽ ảnh hưởng N
      nhân viên" trước khi admin confirm xóa (mục 0)
- [x] `application/delete-role.service.ts` — load role trước (ném `NotFoundException` nếu không thấy
      — chặn double-delete, mục 0), BR_02 (`assertDeletable`), **query `affectedEmployeeIds` TRƯỚC khi
      cascade-strip** (thứ tự bắt buộc — xem bug cache invalidation ở mục 0), BR_04 (tước role khỏi
      mọi `EmployeePermissionProfile`) — tất cả trong 1 `runInTransaction`, publish
      `RoleDeletedDomainEvent` kèm `affectedEmployeeIds` sau khi commit
- [x] `application/list-employees-for-permission.service.ts` — join UserInfo/Account/UDP/Profile/Role,
      trả `assignedModuleNames`/`assignedScopeLabels` (đặt tên rõ ràng: tính từ role.grants trực tiếp,
      KHÔNG qua override/CASL — chỉ overview, không phải nguồn sự thật cho quyền hiệu lực thật),
      `get-employee-permission-profile.service.ts` — load role + override hiện có cho màn sửa
- [x] `application/update-employee-permission.service.ts` — FR_04/05 UC2, validate roleId còn tồn
      tại trước khi gán, publish `EmployeePermissionUpdatedEvent`. **Không dùng `runInTransaction`**
      (khác dự kiến ban đầu) — chỉ ghi đúng 1 collection (`employee_permission_profile`), cùng lý do
      với `create-role`/`update-role` (xem mục 0/3 — transaction chỉ bắt buộc khi ghi ≥2 collection)
- [ ] `application/list-data-scope-policies.service.ts`, `create-data-scope-policy.service.ts`,
      `update-data-scope-policy.service.ts`, `delete-data-scope-policy.service.ts` (chặn nếu
      `countRolesReferencing > 0`, ném `PolicyInUseError`)
- [ ] `application/list-field-scope-policies.service.ts`, `create-field-scope-policy.service.ts`,
      `update-field-scope-policy.service.ts`, `delete-field-scope-policy.service.ts` (tương tự)
- [ ] `application/get-attribute-catalog.service.ts` — phục vụ UI condition builder load danh sách
      attribute hợp lệ theo entity
- [x] `application/resolve-effective-ability.service.ts` — hàm lõi: load role + override (1
      employee) → load policy tương ứng từ `grants` → gọi `ability-rule-builder` (domain) → gọi
      `casl-ability.factory` → trả `Ability`. **Không cache ở đây** (cache là trách nhiệm middleware).
      Resolve thêm `subject` context (`userId`, `departmentId`, `departmentIds` — mảng, vì 1 nhân viên
      có thể thuộc nhiều phòng ban) từ `UserDepartmentPositionModel` để `interpolate()` placeholder.
      **Phát hiện + sửa lỗ hổng thiết kế khi viết file này:** `DataScopePolicy.conditionTree` trước đó
      bắt buộc phải có (không như `FieldScopePolicy` cho phép `null`), nhưng `ConditionTree` domain VO
      luôn đòi ≥1 clause — nên không thể biểu diễn policy "không giới hạn gì" (vd `ALL_COMPANY`), ví
      dụ dùng xuyên suốt plan này. **Đã sửa:** `conditionTree: ConditionTreeProps | null` (domain +
      model + 2 service create/update), thêm `emptyResolvedCondition()` vào
      `condition-compiler.service.ts` (chỉ nơi này được tạo `ResolvedCondition`, giữ đúng invariant)
      trả về `{}` (Mongo filter rỗng = match tất cả) khi `conditionTree === null`.
- [x] `application/handlers/invalidate-permission-cache.handler.ts` — lắng nghe 4 domain event ở
      mục 1, xóa cache Redis key `perm:employee:{id}`. `onRoleDeleted`/`onEmployeePermissionUpdated`
      dùng thẳng `employeeId`/`affectedEmployeeIds` có sẵn trong event; `onDataScopePolicyChanged`/
      `onFieldScopePolicyChanged` phải tự query "role nào tham chiếu policy này" rồi "nhân viên nào
      giữ role đó" (2 policy này không biết trước employee nào bị ảnh hưởng). Có log lỗi
      (`logger.error`) bên trong mỗi handler dù publish vẫn fire-and-forget ở nơi gọi — tránh Redis
      lỗi mà không ai biết. Dùng `Promise.all` + `redis.del()` từng key riêng (không dùng
      `redis.del(...keys)` variadic — mock Redis dùng trong test không hỗ trợ, Redis thật thì không
      có ràng buộc session như MongoDB nên chạy song song an toàn).
      **Phát hiện + sửa khi viết file này:** `update-data-scope-policy.service.ts` và
      `update-field-scope-policy.service.ts` (đã hoàn thành trước đó) **thiếu gọi `publishEvents()`**
      dù entity có buffer event khi sửa condition — nghĩa là sửa Policy trước đó không bao giờ
      invalidate cache (chỉ xóa Policy mới có). Đã bổ sung `publishEvents()` vào cả 2, và thêm side-
      effect import (`import "./handlers/invalidate-permission-cache.handler"`) vào cả 6 service có
      publish event (đúng convention CLAUDE.md — listener phải sẵn sàng kể cả khi test gọi thẳng
      service, không qua route).

### Phase 4 — Interface (HTTP)

- [x] `interface/permission.http.controller.ts` + `interface/permission.routes.ts`, đăng ký ở
      `src/routes/index.js` (prefix `/permissions`). **Bổ sung so với plan gốc:** thêm 3 service
      `get-role-by-id.service.ts`/`get-data-scope-policy-by-id.service.ts`/
      `get-field-scope-policy-by-id.service.ts` — phát hiện lúc viết routes rằng 3 service `list-*`
      cố tình trả bản rút gọn (không có `grants`/`conditionTree` đầy đủ), nhưng màn "sửa" cần xem đủ
      dữ liệu, nên có thêm route `GET .../:id` cho cả Role/DataScopePolicy/FieldScopePolicy (đã làm
      đúng việc này cho Employee từ Phase 3 nhưng quên áp dụng cho 3 cái còn lại):

  | Method | Path | Use case |
  |---|---|---|
  | GET/POST/PATCH/DELETE | `/permissions/roles[/:id]` | HRM.04 (GET/:id trả đủ `grants`, thêm ngoài plan gốc) |
  | GET | `/permissions/roles/:id/deletion-impact` | Preview impact trước khi xóa (mục 0) |
  | GET | `/permissions/employees` | HRM.05 — màn A |
  | GET/PUT | `/permissions/employees/:employeeId` | HRM.05 — màn B |
  | GET/POST/PATCH/DELETE | `/permissions/data-scope-policies[/:id]` | Quản lý Data Scope Policy (GET/:id trả đủ `conditionTree`, thêm ngoài plan gốc) |
  | GET/POST/PATCH/DELETE | `/permissions/field-scope-policies[/:id]` | Quản lý Field Scope Policy (GET/:id tương tự) |
  | GET | `/permissions/attribute-catalog?entity=Employee` | Nạp dữ liệu cho condition builder UI |
  | GET | `/permissions/catalog` | Nạp danh sách permission (đổ dropdown "Chức năng" trong popup Role) |

  Toàn bộ route gate bằng `isAdmin` cho tới khi Phase 5 hoàn thành.

- [x] `index.ts` — export `resolveEffectiveAbility`, `resolveEffectiveRules` (mới tách — xem dưới),
      `toMongoQuery`, `maskFields`, `assertAllowedFields`, toàn bộ service CRUD + type input/result,
      7 domain error. KHÔNG export entity/repository/domain service nội bộ ra ngoài module.
      **Phát hiện + sửa lúc viết file này:** `resolveEffectiveAbility()` trả thẳng `Ability` — không
      serialize được xuống Redis, nên Phase 5 (sắp tới) không có cách nào cache raw rules. Đã tách
      thành `resolveEffectiveRules(employeeId): Promise<RawCaslRule[]>` (JSON-serializable, cái Phase
      5 sẽ cache) + `resolveEffectiveAbility()` giữ nguyên chữ ký cũ (gọi `resolveEffectiveRules` rồi
      `buildAbility()`), không phá test đã có (46 test vẫn pass sau refactor).

### Phase 5 — Cross-cutting: middleware authorize + cache

- [x] `core/authorization/require-permission.middleware.ts` — `requirePermission(action, subject)`.
      Đọc raw rules từ cache Redis `perm:employee:{id}` (không TTL, dùng `redis.set` thường không
      phải `setex`), miss thì gọi `resolveEffectiveRules()` (KHÔNG phải `resolveEffectiveAbility` —
      cần raw rules JSON-serializable để cache) rồi `buildAbility()`. Gắn `req.permissionAbility` cho
      route handler sau dùng tiếp (`toMongoQuery`/`maskFields`). Khai `req.permissionAbility` bằng
      declaration merging **ngay trong file middleware** (không sửa `core/http/express.d.ts` dùng
      chung, tránh file đó phụ thuộc riêng vào module `permission`).
      **Chốt quan trọng (hỏi trực tiếp trước khi code):** middleware này **KHÔNG bypass
      `role === "admin"`** như `hasModuleAccess`/`canManage` cũ — dựa hoàn toàn vào Phase 6 seed
      `PERMISSION_ADMIN` có grant đầy đủ. Lý do: nếu bypass thì admin không có `Ability` thật, mà
      Field Scope đã thiết kế fail-closed (thiếu `fields` = 0 field, không phải "hiện hết") nên phải
      tự chế 1 Ability giả cho admin — phức tạp và đi ngược tinh thần hệ thống mới (mọi quyền đều
      tường minh, kể cả của admin). Đánh đổi: **admin sẽ bị khóa nếu Phase 6 seed thiếu/sai trước khi
      bật middleware này cho bất kỳ route nào** — chỉ dùng `requirePermission` sau khi seed xong.
      Đã spike xác nhận `ability.can(action, subjectType)` (không truyền instance) an toàn, không
      dính bug `$and`/`$or` đã tìm trước Phase 2 — đây đúng pattern "route guard thô" chuẩn của CASL.
      **Sửa sau khi review:** cache key ban đầu `perm:employee:{id}` không phân biệt môi trường —
      Redis dùng chung giữa live/test nên có rủi ro lẫn dữ liệu quyền giữa 2 môi trường. Tách
      `core/authorization/permission-cache-key.ts` (`buildPermissionCacheKey(employeeId)`, tiền tố
      `process.env.BASE_URL` — cùng pattern đã có ở `leave-balance-lock.ts`), dùng chung bởi cả
      middleware này lẫn `invalidate-permission-cache.handler.ts` — tránh 2 nơi tự build key rồi lệch
      nhau (ghi 1 key, xóa 1 key khác, invalidate coi như vô dụng).
- [x] 4 handler ở Phase 3 đã wire đúng convention từ lúc viết (`invalidate-permission-cache.handler.ts`
      + side-effect import ở cả 6 service publish event — xem Phase 3, mục cuối)

### Phase 6 — Seed & bootstrap

**Nguyên tắc đổi hướng (theo yêu cầu mới):** không seed permission kiểu "xem menu"
(`hrm.menu.xxx` — pattern coarse hiện có ở FE `HrmMenuItems.js`, thực chất là permission code của hệ
RBAC cũ). Thay vào đó mỗi `permission_catalog` entry gắn với 1 nhóm API thật (action thật FE gọi khi
vào màn hình đó). FE sẽ tự quyết định hiện/ẩn menu dựa trên `ability.can(action, subject)` của permission
tương ứng với API màn đó cần gọi — không cần permission riêng cho "xem menu" nữa.

**Quy ước đặt tên đã khảo sát và chốt qua toàn bộ route backend (`src/routes/*.js` +
`modules/request`):**
- `permissionCode = "<entity_snake>.<verb>"`, `entity` (field trong catalog, dùng làm CASL subject) =
  PascalCase số ít (vd `Employee`, `Customer`).
- 1 permission gộp **mọi endpoint READ** của 1 entity (list + detail + các biến thể lọc) thành
  `<entity>.view` — phân biệt "xem của mình" vs "xem tất cả" là việc của **Data Scope Policy**, không
  phải nhiều permission code khác nhau.
- WRITE: tách `.create`/`.update` khi 2 quyền có thể khác nhau trong thực tế (Employee, Customer, Post,
  Request...); gộp thành `<entity>.manage` khi hiện tại route gate create+update giống hệt nhau và là
  entity dạng "cấu hình admin" ít khi cần phân quyền lệch nhau (Holiday, PenaltyTier,
  EmploymentStatus, AttendanceMapping, Branch, Department, Position, WifiConfig, ShiftConfig,
  DocumentType, AppIntegration, KpiMetric).
- STRUCTURAL: 1 permission / 1 nghiệp vụ chuyển trạng thái, **không** tách theo từng route con nếu
  route con chỉ là biến thể của cùng 1 hành động nghiệp vụ (vd `PATCH /review/:id` với field `action`
  approve/reject → 1 permission `request.review`, không tách `request.approve`/`request.reject`).
  `.delete` luôn tách riêng khỏi `.manage` (khác actionKind).
- **Loại khỏi catalog** (không phải lỗ hổng, chủ đích): (a) route dùng `verifyInternalRequest` (server
  gọi server, không qua session user — `customer.upsert/bulk-upsert/apply-referral`,
  `agent.upsert/qr`, `investment.upsert/bulk-sync/agent-commission`, `referral.check`); (b) hành động
  tự phục vụ bản thân, ai đăng nhập cũng được làm với dữ liệu của chính mình, không có khái niệm "của
  người khác" nên ABAC không áp dụng (`uploadAvatar/uploadCoverPhoto`, `checkIn/checkOut`,
  `my-payroll-stats`, toàn bộ `chat.js` — nhắn tin nội bộ, `notification.js` trừ `POST /test`, post
  reaction); (c) `auth.js`/`rbac.js` — thuộc phạm vi Phase 7 cutover, không seed ở đây.
- **Cờ cần fix riêng (không thuộc Phase 6, ghi nhận để không quên):** `POST /notification/test` thiếu
  hoàn toàn middleware `authenticate` — lỗ hổng thật, cần vá độc lập với việc seed permission.

**Bảng `permission_catalog` đầy đủ (đã audit qua toàn bộ `src/routes/*.js`):**

*HRM*

| entity | permissionCode | actionKind | Ghi chú |
|---|---|---|---|
| Employee | employee.view | READ | getUsers/getUserById/profile/birthday |
| Employee | employee.create | WRITE | |
| Employee | employee.update | WRITE | |
| Employee | employee.set_status | STRUCTURAL | PATCH employment-status |
| Department | department.view | READ | |
| Department | department.manage | WRITE | create+update gộp |
| Department | department.delete | STRUCTURAL | |
| Position | position.view | READ | |
| Position | position.manage | WRITE | |
| Position | position.delete | STRUCTURAL | |
| LaborContract | labor_contract.create | WRITE | chưa có route list/read — màn "Hợp đồng của tôi" FE đang ComingSoonScreen |
| Attendance | attendance.view | READ | worksheet/stats/calendar/getLichCong/getAllWorkSheets/standard-work-units |
| Attendance | attendance.import | WRITE | import-excel |
| Attendance | attendance.edit | WRITE | admin sửa worksheet |
| WifiConfig | wifi_config.view | READ | |
| WifiConfig | wifi_config.manage | WRITE | |
| WifiConfig | wifi_config.delete | STRUCTURAL | |
| ShiftConfig | shift_config.view | READ | getAllShifts |
| ShiftConfig | shift_config.manage | WRITE | createShift |
| Payroll | payroll.view | READ | payroll-stats-all/:userId (không gồm my-payroll-stats, tự phục vụ) |
| Document | document.view | READ | getListDocument/getFile |
| DocumentType | document_type.manage | WRITE | createTypeDocument |
| InternalFile | internal_file.view | READ | departments/folders/files/viewFile |
| InternalFile | internal_file.manage | WRITE | create/rename/move folder+file, upload |
| InternalFile | internal_file.delete | STRUCTURAL | deleteFolder/deleteFile |
| InternalFilePermission | internal_file_permission.view | READ | |
| InternalFilePermission | internal_file_permission.manage | STRUCTURAL | grant/revoke — không có field payload dạng ghi dữ liệu |
| WeeklyReport | weekly_report.view | READ | my-dept (own) + admin (all) — Data Scope phân biệt |
| WeeklyReport | weekly_report.submit | WRITE | submit/re-submit |
| Holiday | holiday.manage | WRITE | |
| Holiday | holiday.delete | STRUCTURAL | |
| Holiday | holiday.view | READ | |
| EmploymentStatus | employment_status.view | READ | |
| EmploymentStatus | employment_status.manage | WRITE | |
| EmploymentStatus | employment_status.delete | STRUCTURAL | |
| AttendanceMapping | attendance_mapping.view | READ | |
| AttendanceMapping | attendance_mapping.manage | WRITE | |
| AttendanceMapping | attendance_mapping.delete | STRUCTURAL | |
| PenaltyTier | penalty_tier.view | READ | |
| PenaltyTier | penalty_tier.manage | WRITE | |
| PenaltyTier | penalty_tier.delete | STRUCTURAL | |
| Branch | branch.view | READ | |
| Branch | branch.manage | WRITE | |
| Branch | branch.delete | STRUCTURAL | |
| Request | request.view | READ | my (self) + getAll (review) — Data Scope phân biệt |
| Request | request.create | WRITE | |
| Request | request.cancel | STRUCTURAL | |
| Request | request.review | STRUCTURAL | approve/reject gộp 1 permission (đã có sẵn, dùng trong test) |

*Workplace*

| entity | permissionCode | actionKind | Ghi chú |
|---|---|---|---|
| Post | post.view | READ | |
| Post | post.create | WRITE | |
| Post | post.edit | WRITE | sửa bài — Data Scope SELF_ASSIGNED cho user thường, ALL cho quản trị |
| Post | post.delete | STRUCTURAL | |
| Post | post.pin | STRUCTURAL | hiện chỉ canManage("workplace") |
| PostComment | post_comment.create | WRITE | |
| PostComment | post_comment.delete | STRUCTURAL | |
| SharedFolder | shared_folder.view | READ | |
| SharedFolder | shared_folder.manage | WRITE | |
| SharedFolder | shared_folder.delete | STRUCTURAL | |
| SharedFolderPermission | shared_folder_permission.manage | STRUCTURAL | hiện isSuperAdmin — update permissions/default-actions/auto-cleanup |
| SharedFolderAuditLog | shared_folder_audit_log.view | READ | |
| SharedFolderAuditLog | shared_folder_audit_log.delete | STRUCTURAL | clearAuditLogs |
| KpiMetric | kpi_metric.view | READ | |
| KpiMetric | kpi_metric.manage | WRITE | |
| KpiMetric | kpi_metric.delete | STRUCTURAL | |
| PrintJob | print_job.view | READ | status/history/stats |
| PrintJob | print_job.create | WRITE | |

*CRM*

| entity | permissionCode | actionKind | Ghi chú |
|---|---|---|---|
| Customer | customer.view | READ | my-customers/all/export-excel/detail/fluctuation/staff-info — Data Scope SELF_ASSIGNED vs ALL_COMPANY |
| Customer | customer.assign | STRUCTURAL | gộp assign/reassign/unassign-sale (cùng gate `canManage("crm")` hiện tại) |
| Customer | customer.claim | STRUCTURAL | tự claim khách chưa ai nhận (claim-period) — khác `assign` (manager thao tác người khác) |
| CustomerInteraction | customer_interaction.view | READ | |
| CustomerInteraction | customer_interaction.create | WRITE | |
| Agent | agent.view | READ | |
| Investment | investment.view | READ | sales-chart/list/expiring/leaderboard/conversion |
| Commission | commission.view | READ | my-commission (self) + staff-commission (all) — Data Scope phân biệt |
| ClaimPeriod | claim_period.view | READ | history/status |
| ClaimPeriod | claim_period.manage | WRITE | create (hiện isAdmin) |
| ClaimPeriod | claim_period.close | STRUCTURAL | |
| CustomerClaimRequest | customer_claim_request.view | READ | mine + list |
| CustomerClaimRequest | customer_claim_request.create | WRITE | submit |
| CustomerClaimRequest | customer_claim_request.review | STRUCTURAL | approve+reject gộp |
| CustomerClaimRequest | customer_claim_request.revoke | STRUCTURAL | tách riêng — hiện isAdmin, nghiêm hơn review |
| Transaction | transaction.view | READ | |
| Transaction | transaction.create | WRITE | recharge-customer (2 bước gộp 1 permission) |
| DashboardMetric | dashboard_metric.view | READ | **đặt ở CRM chứ không phải workplace** — route thật gate `canManage("crm")`, không phải `"workplace"` như suy đoán ban đầu theo layout FE |
| Customer | customer.ai_insight | READ | ai/customer/:id/summary + churn-risks |
| AiChat | ai_chat.use | WRITE | POST /ai/chat |
| AppIntegration | app_integration.manage | WRITE | |

**3 điểm lệch phát hiện qua audit route thật (cần bạn xác nhận trước khi seed, vì ảnh hưởng
`module`/`entity` gán cho permission, không phải lỗi tôi tự suy diễn):**
1. `GET /weekly-reports/admin` hiện gate bằng `canManage("workplace")` dù đây là màn HRM thuần —
   seed permission `weekly_report.view` với `module: "hrm"` theo đúng bản chất nghiệp vụ, chấp nhận
   lệch tạm thời với gate cũ tới khi Phase 7 cutover route này sang `requirePermission`.
2. `dashboard.js` toàn bộ gate `canManage("crm")` — đã xếp `DashboardMetric` vào module CRM ở trên
   (khác với phỏng đoán ban đầu "workplace" dựa theo vị trí trong FE layout).
3. `POST /notification/test` không có `authenticate` — không liên quan permission catalog, nhưng là
   lỗ hổng thật nên ghi nhận, đề xuất vá riêng (thêm `authenticate`) khi tiện, không block Phase 6.

**`data_scope_policy` — chỉ entity thực sự cần phân biệt "của mình" vs "tất cả" mới seed Policy cụ
thể; phần còn lại 1 permission + không có Policy nào gán (grant không set `dataScopePolicyCode` khi
`validDataScopePolicies` của permission đó rỗng — nghĩa là permission này vốn không phân biệt phạm
vi, có là thấy hết):**

| Entity cần Data Scope thật | Policy dự kiến (code sẽ đặt tiền tố entity vì `DataScopePolicyModel.entity` bắt buộc và `code` unique toàn cục) |
|---|---|
| Employee | `EMPLOYEE_ALL_COMPANY`, `EMPLOYEE_OWN_DEPARTMENT`, `EMPLOYEE_SELF` |
| Request | `REQUEST_ALL_COMPANY`, `REQUEST_SELF` (không có `REQUEST_DIRECT_REPORTS` — xem "Ngoại lệ kiến trúc" bên dưới) |
| Customer | `CUSTOMER_ALL_COMPANY`, `CUSTOMER_SELF_ASSIGNED` (theo `referred_by`, xác nhận thật qua `CustomerController.getMyCustomers`) |
| Commission | `COMMISSION_ALL_COMPANY`, `COMMISSION_SELF_ASSIGNED` (theo `commission.sale_id`, xác nhận thật qua `InvestmentController.getMyCommission`) |
| WeeklyReport | `WEEKLY_REPORT_ALL_COMPANY`, `WEEKLY_REPORT_OWN_DEPARTMENT` |
| InternalFile | `INTERNAL_FILE_ALL_COMPANY`, `INTERNAL_FILE_OWN_DEPARTMENT` — **tạm bỏ qua tier ACL** (`DeptFolderPermission.grantedUsers/grantedDepts`), xem "Ngoại lệ kiến trúc" bên dưới |
| Post | `POST_ALL_COMPANY` (view/create/pin) + `POST_SELF_ASSIGNED` (chỉ dùng cho `post.edit`/`post_comment.delete` — sửa/xoá bài, comment của chính mình) |

**Ngoại lệ kiến trúc — 2 trường hợp không đi qua Data Scope Policy generic:**
1. **`request.review`** — ai duyệt được đơn nào do `getApprovalChain()` (đồ thị phòng ban + fallback
   department.manager/admin, gọi lồng cả `can()` của RBAC cũ) xử lý, không phải so sánh attribute tĩnh
   — quyết định A đã chốt: giữ nguyên `getApprovalChain()`, không nhét vào `ConditionTree`.
2. **`internal_file.view`/`.manage`** — ngoài phòng ban sở hữu, còn có tier ACL cấp quyền chéo phòng
   ban qua `DeptFolderPermissionModel` (`grantedUsers` theo cá nhân, `grantedDepts` theo cả 1 phòng
   ban khác — giống hệt `SharedFolder.permissions[]` cũng có pattern này, có thêm chiều per-action
   view/download/upload/delete_file/manage). Đã xác nhận qua code thật `InternalFileController.canViewDept()`
   **và phát hiện phụ**: `canUploadToDept()` hiện giống hệt `canViewDept()` — người được cấp quyền qua
   ACL đang upload được luôn, không "chỉ xem" như mô tả trong CLAUDE.md (lệch giữa doc và code, chưa sửa).
   Đây là ACL theo từng resource cụ thể (ai được chia sẻ folder nào), khác bản chất với Data Scope Policy
   (rule tĩnh theo role) — **quyết định: không migrate vào Role/Override, giữ nguyên
   `DeptFolderPermissionModel`/`SharedFolder.permissions[]`; Data Scope Policy của `InternalFile` (nếu
   sau này cần) chỉ nên ĐỌC 2 bảng đó lúc resolve subject context, không tái tạo logic ACL trong
   `ConditionTree`.** **Theo yêu cầu user, tạm bỏ qua toàn bộ phần ACL này ở Phase 6** — chỉ seed
   `INTERNAL_FILE_ALL_COMPANY`/`INTERNAL_FILE_OWN_DEPARTMENT` (thiếu tier ACL, chấp nhận tạm thời,
   không block Phase 6/7).

Entity còn lại (Department, Position, Holiday, PenaltyTier, EmploymentStatus, AttendanceMapping,
Branch, WifiConfig, ShiftConfig, DocumentType, KpiMetric, PrintJob, SharedFolder*, Agent, Investment,
ClaimPeriod, CustomerClaimRequest, Transaction, AppIntegration...) seed đúng 1 Policy
`<ENTITY>_ALL_COMPANY` (`conditionTree: null`) — dữ liệu công ty dùng chung, không có khái niệm sở
hữu theo dòng, giữ `validDataScopePolicies` của permission tương ứng chỉ gồm đúng 1 policy này. Field
path chính xác của mỗi `ConditionTree` (vd `Employee.OWN_DEPARTMENT` cần biết đúng field department
trên `UserModel`/`UserDepartmentPositionModel`) sẽ tra lại model thật khi viết từng seed entry, không
đoán trước ở bước thiết kế này.

- [x] Seed `entity_attribute_catalog` cho 7 entity có Data Scope thật
      (`scripts/seedPermissionEntityAttributeCatalog.ts`) — field path xác nhận qua model thật, không
      đoán (`Customer.referred_by`, `Investment.commission.sale_id`... xem code). 2 dependency ghi chú
      lại cho Phase 7: Employee cần `$lookup` qua `user_department_position` (không có field department
      trực tiếp trên `user_info`), Post cần thêm `subject.accountId` vào subject context (author_id trỏ
      `account`, khác 6 entity còn lại đều trỏ `user_info`)
- [x] Seed `permission_catalog` (`scripts/seedPermissionCatalog.ts`) — 87 permission (nhiều hơn ước
      tính ~65 ban đầu, do audit chi tiết hơn khi viết thật), `supportsFieldScope` suy tự động từ
      `actionKind` (không gõ tay, tránh lệch quy ước)
- [x] Seed `data_scope_policy` (`scripts/seedPermissionDataScopePolicy.ts`) — 45 policy (15 real-scope
      cho 7 entity + 30 generic `<ENTITY>_ALL_COMPANY`), tất cả `isSystemPolicy: true`
- [x] Seed Role `PERMISSION_ADMIN` (`scripts/seedPermissionAdminRole.ts`) — đọc thẳng
      `permission_catalog` hiện có trong DB để build grants (không hard-code lại danh sách permission
      lần 2, tránh lệch), lấy `validDataScopePolicies[0]` làm scope rộng nhất (đã đảm bảo mọi mảng
      trong `seedPermissionCatalog.ts` xếp policy rộng nhất lên đầu), tự gán cho mọi account
      `role: "admin"` hiện có qua `EmployeePermissionProfile`. Cả 4 script idempotent (tạo/cập
      nhật/bỏ qua), chưa chạy lên DB thật — người dùng tự chạy khi sẵn sàng, theo đúng thứ tự
      entity_attribute_catalog → permission_catalog → data_scope_policy → admin role.
- [x] Quyết định: **không** migrate 2 hệ thống ACL theo-resource đang có
      (`DeptFolderPermissionModel` cho Internal File, `SharedFolder.permissions[]`) vào
      Role/Override/Data Scope Policy — khác bản chất (ACL theo từng resource cụ thể, không phải rule
      tĩnh theo role). Tạm bỏ qua tier ACL của Internal File ở Phase 6 theo yêu cầu — xem "Ngoại lệ
      kiến trúc" phía trên.

### Phase 7 — Cutover (chi tiết sau, không block Phase 1-6)

- [x] `GET /permissions/me` — coarse-grained, action không gắn resource cụ thể (menu-gating/route
      guard), KHÔNG dùng để check quyền trên 1 resource cụ thể. Đặt trước
      `router.use(authenticate, isAdmin)` trong `permission.routes.ts` (chỉ cần `authenticate`, không
      cần admin — mọi nhân viên tự hỏi quyền của chính mình). Thuật toán: gom mọi cặp
      `(action, subject)` xuất hiện trong `rawRules` rồi để `ability.can(action, subject)` (dạng
      route-guard thô, không truyền instance — đã xác nhận an toàn ở Phase 2) tự phân xử, **không** tự
      lọc theo `inverted` — vì 1 override BLOCK không điều kiện có thể xoá quyền tưởng như đang có từ
      1 rule "can" khác, tự lọc tay sẽ sai. `resolveEmployeeId` (account → employee) tách ra
      `core/authorization/resolve-employee-id.ts` dùng chung với `require-permission.middleware.ts`
      (tránh 2 nơi tự resolve rồi lệch, cùng lý do đã tách `permission-cache-key.ts`). 5 test mới
      (`__tests__/permissionGetMyEffectivePermissions.test.ts`), toàn bộ 59 test (9 file) pass.
      `_actions` (fine-grained, per-record) **chưa làm** — theo đúng quyết định đã chốt, chỉ làm khi
      cutover từng route cụ thể, không làm trước.
- [x] Khảo sát tổ hợp `role`/`module_access`/`dept_scope` thật trên `AccountModel`
      (`scripts/surveyLegacyAccountPermissions.ts`, read-only) — 66 account active, 12 tổ hợp, 4 tổ
      hợp phổ biến chiếm 86% (`user+none+own`: 24, `user+crm+own`: 21, `manager+crm+own`: 8,
      `admin+none+own`: 4), 8 tổ hợp còn lại mỗi cái 1 account. **Lệch so với bảng ví dụ trong
      CLAUDE.md**: doc ghi "Sale CRM manager → dept_scope: all" nhưng thực tế 8/9 manager CRM đang là
      `own`, chỉ 1 người `all` — bảng CLAUDE.md mô tả thiết kế dự định, không phải dữ liệu thật.
- [x] **Quyết định: KHÔNG viết script tự động migrate account → Role.** Người dùng tự gán Role cho
      từng account thủ công qua `PUT /permissions/employees/:employeeId` (đã có sẵn từ Phase 4) khi
      sẵn sàng — không phải việc tự động hoá. Role bao nhiêu cái, gán cho ai là quyết định của người
      dùng ngoài phạm vi code.
- [x] **Pilot cutover — module `request`** (`request.routes.ts`): thêm `requirePermission` cho cả 7
      route (`request.view`/`create`/`cancel`/`review`). **Không** áp `toMongoQuery` cho module này —
      lý do kỹ thuật, không phải rủi ro vận hành: `getAllRequests` dùng `resolveRequestViewScope()` →
      `getManagedUserIds()` (đệ quy cây phòng ban + `department.manager`), cùng loại "không diễn đạt
      được bằng `ConditionTree` tĩnh" như `request.review`/`getApprovalChain()` đã xác nhận trước đó —
      migrate sẽ làm quản lý mất đúng danh sách cấp dưới (thấy 0 hoặc thấy hết công ty). Giữ nguyên
      `resolveRequestViewScope`/`getApprovalChain`, chỉ thêm gate thô ở route. Tương tự **chưa** áp
      `maskFields`/`assertAllowedFields` — chưa Field Scope Policy nào tồn tại cho bất kỳ entity nào
      (kể cả seed `PERMISSION_ADMIN`), áp ngay sẽ làm mọi response rỗng hoàn toàn (fail-closed).
  - Helper test mới `__tests__/helpers/grantRequestPermission.js` — seed nhanh
    catalog+policy+role cho test HTTP cần vượt qua gate `requirePermission`.
  - 4 file HTTP test cutover xong, pass đủ: `get-request-by-id.http.test.js` (4/4),
    `get-my-requests.http.test.js` (9/9), `get-all-requests.http.test.js` (6/6 — kèm sửa 1 bug có sẵn
    từ trước: 2 test thiếu `?intent=review` trên URL nên chạy nhầm nhánh `overview`, không phải do
    cutover gây ra, xác nhận qua `git stash` tách riêng thay đổi), `eligible-reviewers.http.test.js`
    (3/3).
  - **2 file fail, xác nhận không liên quan tới cutover, không sửa (ngoài phạm vi Phase 7):**
    `requestApprovalFlow.test.js` (gọi thẳng controller, bypass hoàn toàn Express/middleware — không
    thể bị ảnh hưởng bởi `requirePermission`; 4 fail nằm trong chính `getApprovalChain()`/`can()` RBAC
    cũ) và `resolve-request-view-scope.test.js` (2 fail, cùng gốc). Cả 2 xác nhận fail giống hệt khi
    tạm bỏ thay đổi `request.routes.ts` ra (`git stash`).
- [x] **Cutover module HRM (backend + FE)** — phạm vi xác nhận qua `url:` thật trong
      `HrmMenuItems.js`, không suy đoán:
  - **9 route file** đổi `isAdmin`/`hasModuleAccess`/`canManage`/`requirePermission` (RBAC cũ,
    `helpers/rbac`) sang `requirePermission` mới: `user.js`, `department.js`, `laborContract.js`,
    `attendance.js`, `document.js`, `branch.js`, `attendanceMapping.js`, `holiday.js`,
    `employmentStatus.js`. **Loại khỏi phạm vi**: `internalFile.js`/`weeklyReport.js` (thuộc
    `WorkplaceMenuItems.js`, không phải HRM), `penaltyTier.js` (chưa FE nào gọi, grep xác nhận).
    Đã xác nhận không đụng `approval-chain.ts`/`resolveRequestViewScope` (grep + chạy lại
    `requestApprovalFlow.test.js`, vẫn đúng 4 fail có sẵn từ trước, không phát sinh mới) — 2 hệ tách
    biệt hoàn toàn, cutover route HRM không ảnh hưởng chuỗi duyệt đơn.
  - **FE `RbacScreen.jsx`** — thêm nút "Gán nhân viên" trên mỗi dòng Role (tab Danh sách Vai trò):
    dialog chọn nhiều nhân viên, gán/gỡ role hàng loạt thay vì phải vào từng người — tab "Gán quyền
    Nhân viên" giữ nguyên không đổi. Logic đưa vào hook `useBulkAssignRoleMutation` (repo có rule
    ESLint riêng cấm gọi `*Api` thẳng trong component).
  - **FE menu HRM** — `GET /permissions/me` (đã có từ trước) wire qua hook mới
    `features/permission/hooks/useMyPermissions.js` (KHÔNG sửa `hooks/usePermissions.js` chung — tránh
    ảnh hưởng CRM/màn khác còn dùng RBAC cũ, đây là cơ chế song song chỉ dùng cho menu HRM).
    `HrmMenuItems.js`: đổi toàn bộ `permissionAny: ["hrm.menu.xxx"]` sang permission code mới
    (`employee.view`, `department.view`...); bỏ hẳn `permissionAny` ở các menu cha thuần nhóm (tự ẩn
    khi children rỗng, logic có sẵn trong `HrmLayout.jsx`) và ở các màn `ComingSoonScreen` chưa có API
    thật; 2 màn `/hrm/phan-quyen` và `/hrm/phan-quyen-chi-tiet` dùng field mới `adminOnly: true` (check
    `role==="admin"` qua `usePermissions()` cũ) thay vì permission code — 2 màn này quản lý chính hệ
    thống phân quyền, không có permission code nào trong catalog mới phù hợp để tự gate chính nó.
  - **Rủi ro đã biết, chưa xử lý**: seed Phase 6 chưa chạy lên DB thật, chưa nhân viên nào (trừ admin
    tự seed) được gán Role — bật cutover này lên môi trường thật trước khi seed + gán Role sẽ làm
    toàn bộ menu HRM biến mất với mọi người dùng.
- [ ] Thay `isAdmin`/`hasModuleAccess`/`canManage` cho các module còn lại (Workplace/CRM, chưa DDD)
      bằng `requirePermission`
- [ ] Áp `toMongoQuery`/`maskFields` vào API list/get của entity có Data Scope/Field Scope THẬT phù
      hợp (Employee/Customer/WeeklyReport — flat scope, khác `request` không áp được vì lý do trên)
- [ ] Xóa field `role`/`module_access`/`dept_scope` khỏi `AccountModel` sau khi mọi route đã cutover
