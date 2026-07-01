# Phân hệ Quản trị KPI — Tóm tắt & Kế hoạch triển khai

> Tài liệu làm việc nội bộ. Đối chiếu BRD *"Quản trị Mục tiêu & Đánh giá Hiệu suất (KPI)"* với codebase/DB hiện tại (`v-Work-API`).
> BRD là **khung** — file này nêu rõ cái gì đã có, cái gì thiếu, và các **điểm cần thảo luận** trước khi code.
> Cập nhật: 2026-06-24.

---

## 1. Tóm tắt nghiệp vụ (BRD nói gì)

Xây phân hệ KPI cho **khối Kinh doanh Đầu tư (Tikluy)**. Số hóa luồng giao chỉ tiêu từ BOD → Giám đốc TTKD → Trưởng phòng → Sale.

**2 nhóm KPI:**
- **Output / Tài chính (auto-sync từ CRM, Sale KHÔNG nhập tay):** Doanh số đầu tư, CIF mới, eKYC, KH đầu tư, active investors.
- **Input / Tác nghiệp (Sale nhập tay – F04):** Cuộc gọi telesale, SMS/Zalo/Email, Merchant/CTV đăng ký & active, Event/Roadshow.

**Các cơ chế đặc thù:**
- **Đa khung thời gian:** Ngày / Tuần / Tháng / Quý / Năm / Tùy chọn.
- **Phân rã kế hoạch:** KH Tuần = KH Tháng / số tuần; KH Ngày = KH Tháng / số ngày làm việc thực tế (trừ CN, lễ).
- **Rollover (dồn số):** Hụt chỉ tiêu ngày T → cộng dồn nợ sang ngày T+1. `Target(T) = BaseDaily + [Target(T-1) − Actual(T-1)]`. Áp dụng cả DS lẫn số lượng tác nghiệp. Chạy 23:59 hàng ngày.
- **Doanh số NET:** `NET = Tổng Vào − Tổng Ra`. Mọi giao dịch Vào/Ra phải gắn **nguồn**: MKT / CBB / BLĐ.
- **Clawback (truy thu):** KH tất toán/rút trước hạn → trừ KPI theo thời điểm rút:
  - Cùng tuần → trừ KPI Tuần + Tháng.
  - Khác tuần, cùng tháng → trừ KPI Tháng.
  - Khác tháng → trừ Lũy kế Năm (tháng cũ đã chốt). Reset khi BOD nhập KPI năm mới.
- **5 Bậc (Tier 1–5):** Giám đốc TTKD cấu hình định mức 5 bậc cho từng hạng mục (Đầu tư, CIF, CTV, Merchant…) rồi gán bậc cho từng nhân sự. Hệ thống map kết quả thực đạt với bậc để đánh giá.
- **Phân rã KPI năm → 12 tháng:** 4 thuật toán — Chia đều / Tịnh tiến / Mùa vụ / Cân bằng bù trừ.
- **Funnel validation (BR03):** Lead → Gọi → CIF → eKYC → DS. Lũy kế bước sau ≤ bước trước.

**4 vai trò + Dashboard:**
| Vai trò | View | Thao tác |
|---|---|---|
| **Sale** | 5.1 (chỉ tiêu cá nhân, DS NET, Clawback) | F04 nhập tác nghiệp thủ công |
| **Trưởng phòng KD** | 5.1 tổng hợp toàn phòng + drill-down từng Sale | F03 giao Combo KPI cho Sale |
| **Giám đốc TTKD** | 5.2 (BC kết quả KD), 5.3 (phân rã 12 tháng) của TTKD mình | F02 phân bổ tỷ trọng tháng; cấu hình 5 bậc + gán bậc |
| **Admin / BOD** | 5.4 (xếp hạng toàn hệ thống) + drill xuống 5.2 từng TTKD | F02 giao KPI Năm cho Giám đốc TTKD |

---

## 2. Hiện trạng codebase / DB (cái gì đã có)

### Mô hình tổ chức
- **TTKD = `department` có `type: "branch"`** dưới division `Chi Nhánh & TTKD` (KHOI-CN). Hiện có **3**: `TTKD-HN`, `TTKD-HP`, `TTKD-HCM`. BRD liệt kê **6** (thêm Priority, Sale Online 24/7, TT PT Đối tác).
  - ⚠️ Có collection **`branches` riêng** (Hội Sở / Hải Phòng / HCM) — khái niệm **khác**, không phải TTKD. Đừng nhầm.
- `positions`: 6 chức danh generic (Chuyên viên, Trưởng nhóm, Trưởng bộ phận, Giám đốc, Nhân Viên, Giám đốc kinh doanh). **Không có khái niệm "bậc sale"** — bậc Tier 1–5 trong BRD là **định mức KPI**, không phải chức danh.
- Phân quyền: `account.role` (admin/manager/user) + `module_access` (hrm/workplace/crm) + `dept_scope` (own/all). Quan hệ user↔phòng qua `user_department_position` (user → `user_info._id`).

### Nguồn dữ liệu cho Output KPI (auto-sync) — ĐÃ CÓ
| KPI BRD | Nguồn dữ liệu sẵn có | Ghi chú |
|---|---|---|
| Doanh số đầu tư (Vào) | `investments` (45) — `amount`, `invested_at`, `commission.sale_id`, `status` | sale_id ref `user_info` |
| Doanh số Vào / Ra (dòng tiền) | `fluctuation_histories` (778) — `is_plus` (true=Vào/false=Ra), `fluctuated_amount`, `transaction_date` | **Nguồn NET tự nhiên nhất** |
| Nạp/rút | `transaction_histories` (71) — `category`, `amount`, `is_auto` | |
| CIF mới | `customers` status `registered` (211) | |
| eKYC | `customers` status `kyc_verified` (81), `identity.verified_at`, `ekyc_commission` | |
| Tất toán trước hạn (Clawback) | `investments.status = early_terminated / matured` | dùng để truy thu |
| Nguồn DS | `customers.source_type` + `investments.commission.receiver_type`: `sale/agent/marketing` | cần map sang MKT/CBB/BLĐ |

### Nguồn cho Input KPI (manual) — MỘT PHẦN
- `customer_interactions` (41): `type` = call/meeting/message/email/note… Hiện gần như chỉ có `note`.
- **Thiếu:** đếm SMS/Zalo riêng, Event/Roadshow, Merchant/CTV đăng ký & active, **form tự khai báo gộp theo ngày** (F04).

### Hỗ trợ khác — ĐÃ CÓ
- `holidays` → tính "số ngày làm việc thực tế" cho KH Ngày.
- `agents` (4) → CTV/Merchant (cá nhân/doanh nghiệp).
- `claim_periods` (19) → kỳ hoa hồng (tham khảo cách chia kỳ tháng).
- Cron infra (`node-cron`, TZ Asia/Ho_Chi_Minh), transaction MongoDB (replica set), push notification.

### `SaleKpiModel` hiện tại
- Đã tồn tại nhưng **chưa được dùng** (không controller/route). 1 bản ghi test.
- Chỉ có: target/actual theo **tháng**, 4 chỉ số (new_customers, kyc_verified, active_investors, revenue).
- **Thiếu gần hết:** đa khung thời gian, cấp TTKD, rollover, clawback, NET Vào/Ra, 3 nguồn, 5 bậc, input KPI, phân rã.
- → **Khả năng cao phải thiết kế lại model**, không mở rộng cái cũ.

---

## 3. Khoảng trống & quyết định cần thảo luận (QUAN TRỌNG)

> Đây là phần cần **anh và em thống nhất** trước khi viết code. Mỗi mục là 1 ngã rẽ kiến trúc.

### Q1. Mô hình hóa "vai trò KPI" thế nào?
BRD có 4 vai trò (Sale / Trưởng phòng / Giám đốc TTKD / BOD) nhưng hệ thống chỉ có `role` + `dept_scope` + `position`. **Đề xuất:** suy ra vai trò từ `position` + cây `department` (Giám đốc TTKD = Giám đốc tại node type=branch; Trưởng phòng = trưởng nhóm/bộ phận trong TTKD). Cần xác nhận cách nhận diện chính xác, hay thêm field/module_access mới (vd `module_access: "kpi"`).

### Q2. Nguồn "chuẩn" để tính Doanh số NET?
- Phương án A: dùng `investments` (Vào) + `investments.status` (Ra/tất toán) — bám sát hoa hồng & clawback theo từng khoản đầu tư.
- Phương án B: dùng `fluctuation_histories` (`is_plus`) — đúng nghĩa dòng tiền Vào/Ra hơn, nhưng khó gắn `sale_id`/nguồn.
- **Đề xuất:** Output KPI cho Sale dựa trên `investments` (gắn được sale_id + clawback theo khoản). `fluctuation_histories` dùng cho con số NET tổng cấp TTKD/BOD. → **Cần chốt.**

### Q3. 3 nguồn MKT / CBB / BLĐ map từ đâu?
Hiện chỉ có `sale/agent/marketing`. Mapping đề xuất: `marketing→MKT`, `sale→CBB`, còn **BLĐ** chưa có nguồn dữ liệu. → Cần bổ sung field phân loại nguồn (cả chiều Vào lẫn Ra) hoặc quy ước map. **Cần chốt cách gán BLĐ.**

### Q4. Clawback — lưu vết & thời điểm tính?
Cần 1 bảng `kpi_adjustment` ghi log mỗi lần truy thu (khoản đầu tư nào, rút lúc nào, trừ vào kỳ nào). Quy tắc "khác tháng → trừ Lũy kế Năm, reset khi nhập KPI năm mới" cần định nghĩa rõ mốc reset. **Cần chốt.**

### Q5. Rollover — lưu snapshot theo ngày?
Để có `Actual(T-1)`/`Target(T-1)` cần bảng KPI **theo ngày** (snapshot daily) chứ không chỉ theo tháng. Đây là lựa chọn lưu trữ lớn: lưu sẵn daily target (precompute lúc giao combo) vs tính on-the-fly. **Đề xuất:** precompute daily rows + cron 23:59 cập nhật rollover. **Cần chốt.**

### Q6. "Combo KPI" lưu thế nào?
1 combo = nhiều chỉ tiêu (Output + Input) cho 1 Sale/tháng. → Model `kpi_assignment` với map các metric. Danh mục metric nên **động** (F01 quản lý danh mục) hay **cố định cứng**? **Đề xuất:** danh mục động (`kpi_metric` catalog) để thêm Zalo/SMS/Event không phải sửa code.

### Q7. Input KPI nhập tay (F04) — model mới?
`customer_interactions` không đủ (cần đếm theo loại, theo ngày, có cả không gắn customer như SMS blast/event). **Đề xuất:** model `kpi_daily_report` (self-declaration) tách riêng, tổng hợp số lượng theo metric/ngày/sale.

### Q8. Phạm vi giai đoạn 1?
BRD rất lớn (PowerBI, 4 thuật toán phân rã, leaderboard realtime…). **Đề xuất** làm MVP trước (xem mục 5), để PowerBI/thuật toán mùa vụ/clawback phức tạp sang phase sau.

---

## 4. Mô hình dữ liệu (đã chốt — 2026-06-29)

> Không còn là nháp. Tất cả model đã được tạo, schema khớp với mô tả bên dưới.

```
kpi_metric ✅           # F01 — danh mục chỉ tiêu (động)
  code (immutable), name, group: "output"|"input"
  unit, source: "auto"|"manual", auto_source, is_active

kpi_year_plan ✅        # F02 — KPI năm của TTKD (Giám đốc TTKD lập & điều chỉnh)
  ttkd_id, year, metric_code
  year_target
  monthly_targets: [{ month 1–12, base_target, adjusted_target, is_adjusted }]
    base_target     = giá trị gốc khi lập, không đổi
    adjusted_target = GĐ TTKD có thể điều chỉnh từng tháng
    is_adjusted     = đánh dấu tháng đã bị override
  status: draft|active|superseded, version, created_by (account GĐ TTKD), activated_at

kpi_assignment ✅       # F03 — Combo KPI tháng cho Sale (Trưởng phòng giao)
  sale_id (user_info), ttkd_id, assigned_by (account)
  year, month, version
  items: [{ metric_code, target }]
  status: draft|active|superseded, activated_at

kpi_period_target ✅    # Core tracking — actual vs target theo từng kỳ (dùng cho rollover + dashboard)
  scope_type: "ttkd"|"sale"
  scope_id            → department._id nếu ttkd / user_info._id nếu sale
  metric_code
  period_type: day|week|month|quarter|year
  period_key          → "2026-06-29" / "2026-W26" / "2026-06" / "2026-Q2" / "2026"
  base_target, rollover_in, effective_target (= base + rollover)
  actual, achievement_pct
  source_breakdown: { mkt, cbb, bld }
  is_closed, closed_at, closed_by

kpi_daily_report ✅     # F04 — Sale tự khai báo Input KPI hàng ngày
  sale_id, ttkd_id, date (start of day)
  items: [{ metric_code, value }]
  status: draft|submitted, submitted_at

kpi_adjustment ✅       # Clawback log — ghi vết mỗi lần truy thu
  investment_id, sale_id, ttkd_id
  metric_code, amount (luôn dương)
  reason: early_terminated|cancelled
  withdrawal_date
  period_type, applied_period_key   → kỳ bị trừ
  created_by

kpi_tier_config ✅      # 5 bậc — Giám đốc TTKD cấu hình ngưỡng mỗi năm
  ttkd_id, metric_code, year
  tiers: [{ level 1–5, threshold }]
  configured_by

kpi_tier_assignment ✅  # Gán bậc cho từng Sale (lịch sử đầy đủ)
  sale_id, ttkd_id, metric_code
  tier_level (1–5)
  assigned_by, effective_from, effective_to (null = đang áp dụng)
```

---

## 5. Phân rã công việc (Backlog theo phase)

### Phase 0 — Thống nhất & nền tảng
- [ ] Chốt Q1–Q8 ở mục 3 (buổi thảo luận).
- [x] Seed/đồng bộ đủ 6 TTKD (department type=branch) theo BRD — thêm 3 TTKD chức năng (Priority, Online 24/7, PT Đối tác) vào `scripts/seedOrgTree.js`. ✅ đã chạy `node scripts/seedOrgTree.js` — DB có đủ 6 TTKD.
- [ ] Chốt cách nhận diện vai trò Giám đốc TTKD / Trưởng phòng (Q1).
- [ ] Chốt nguồn dữ liệu NET & clawback (Q2, Q4).

### Phase 1 — Catalog & Giao chỉ tiêu (F01, F02, F03)
- [x] `kpi_metric` model + CRUD (admin) — danh mục KPI động.
- [x] `kpi_assignment` model — Combo KPI tháng, Trưởng phòng giao cho Sale. Controller + route đầy đủ (draft/active/superseded, versioning, transaction activate).
- [x] Tất cả 6 model KPI còn lại đã tạo: `kpi_year_plan`, `kpi_period_target`, `kpi_daily_report`, `kpi_adjustment`, `kpi_tier_config`, `kpi_tier_assignment`. Schema + index đã chốt (xem mục 4).
- [ ] `kpiDecompose.js` — engine thuần phân rã năm → 12 tháng (equal / linear / seasonal).
- [ ] Controller + route `kpi_year_plan` (GĐ TTKD lập/điều chỉnh kế hoạch năm).
- [ ] Engine **phân rã** tháng → tuần → ngày (dùng `holidays` tính ngày làm việc).
- [ ] API + middleware phân quyền theo 4 vai trò KPI.

### Phase 2 — Auto-sync Output KPI
- [ ] Service tổng hợp Doanh số (Vào) từ `investments` theo sale/ttkd/kỳ.
- [ ] Service CIF/eKYC từ `customers`.
- [ ] Tính NET (Vào − Ra) + phân tách 3 nguồn MKT/CBB/BLĐ (sau khi chốt Q3).
- [ ] Cron đồng bộ actual định kỳ; cập nhật `kpi_period_target.actual`.

### Phase 3 — Input KPI thủ công (F04)
- [ ] `kpi_daily_report` model + form API (Sale tự khai báo).
- [ ] Tổng hợp Input actual vào KPI kỳ.
- [ ] (Tùy chọn) Funnel validation BR03.

### Phase 4 — Rollover & Clawback
- [ ] Bảng KPI theo ngày + cron **23:59** tính rollover (BR02).
- [ ] `kpi_adjustment` + logic Clawback theo thời điểm rút (BR04/BR05).
- [ ] Chốt tháng (F05): khóa dữ liệu, kết chuyển nợ/vượt.

### Phase 5 — 5 Bậc (Tier)
- [ ] `kpi_tier_config` + `kpi_tier_assignment` (Giám đốc TTKD cấu hình & gán).
- [ ] Map kết quả thực đạt → đánh giá bậc.

### Phase 6 — Dashboard & Bộ lọc đa kỳ
- [ ] API Dashboard 5.1 (Sale), 5.1 tổng hợp + drill-down (Trưởng phòng).
- [ ] API 5.2 (BC kết quả KD TTKD), 5.3 (phân rã 12 tháng).
- [ ] API 5.4 (leaderboard BOD) + sort động.
- [ ] Bộ lọc thời gian động dùng chung (Ngày/Tuần/Tháng/Quý/Năm/Tùy chọn).
- [ ] (Phase sau) Tích hợp biểu đồ PowerBI.

---

## 6. Đề xuất MVP (làm trước để có giá trị sớm)
1. `kpi_metric` + `kpi_assignment` (giao Combo KPI tháng cho Sale).
2. Phân rã Tháng → Tuần → Ngày.
3. Auto-sync **Doanh số đầu tư + CIF + eKYC** từ dữ liệu sẵn có.
4. Dashboard 5.1 cho Sale + 5.1 tổng hợp cho Trưởng phòng, có bộ lọc đa kỳ.

→ Rollover, Clawback, 5 Bậc, phân rã năm 4 thuật toán, leaderboard BOD, PowerBI: **phase sau**.

---

## 7. Câu hỏi mở tổng hợp (cần anh quyết)
1. Vai trò KPI suy ra từ position+department hay thêm quyền mới? (Q1)
2. NET tính từ `investments` hay `fluctuation_histories`? (Q2)
3. BLĐ là nguồn nào trong dữ liệu? (Q3)
4. Mốc reset Clawback "năm mới" định nghĩa thế nào? (Q4)
5. Có cần đủ 6 TTKD ngay không, hay làm với 3 cái hiện có?
6. Phạm vi MVP có đồng ý như mục 6 không? (Q8)

---

## 8. Quyết định kiến trúc (ADR — ghi "vì sao" để khỏi tranh luận lại)

**ADR-01 — Phân quyền KPI dùng RBAC riêng, KHÔNG gộp vào `account.role`/`module_access`.**
Phạm vi: CHỈ module KPI. Lý do: 4 vai trò KPI (sale/sale_manager/ttkd_director/bod) không map sạch vào admin/manager/user. Các module khác giữ nguyên hệ cũ. Chấp nhận tồn tại 2 hệ song song có ranh giới rõ.

**ADR-02 — Action và Scope là 2 trục độc lập. Permission KHÔNG mang scope.**
`kpi.dashboard.view` chỉ trả lời "được làm gì", không trả lời "thấy dữ liệu của ai". Lý do: nếu nhét scope vào tên permission (`..._ttkd_HN`) sẽ nổ tổ hợp + phải tạo permission mới mỗi khi mở TTKD mới. Scope sẽ là thuộc tính trên `user_roles`.

**ADR-03 — Scope tạm HOÃN, nhưng giữ "đường nối".**
`getScope()` hiện trả `{level:"all"}`. `user_roles` để là bảng riêng để sau thêm cột `scope_level`/`scope_ttkd_ids` không phải tái cấu trúc. Mọi controller gọi `getScope()` — sau nâng cấp chỉ sửa 1 hàm.

**ADR-04 — Luật resolve quyền: DENY > ALLOW, user-level > role-level.**
`role_permissions` chỉ GRANT (dương, sạch để audit). `user_permissions` có `effect: allow|deny`. Công thức: `effective = (∪ role grants) ∪ (user allow) ∖ (user deny)`. Lõi tách ở `rbacResolve.js` (thuần, có unit test).

**ADR-05 — Role ≠ Position.** `roles` = gói quyền (RBAC, mới). `position` = chức danh HR (đã có). Không gộp: cùng `position_name` ("Giám đốc") có thể cần quyền khác nhau tùy phòng ban. Liên hệ qua việc admin gán (sau có thể thêm lớp suy luận).

**ADR-06 — ~~Seed-as-code~~ → BỎ.** ~~Permission + role + ma trận định nghĩa ở `src/config/rbacDefinitions.js`, seed idempotent lúc startup (`jobs/seedRbac.js`).~~ Đã **bỏ seed RBAC** (2026-06-24): xóa `rbacDefinitions.js` + `jobs/seedRbac.js`. Production không seed tự động; permission/role tạo qua API admin `/rbac`. Danh mục mã quyền giữ ở `src/constants/permissions.js`.

**ADR-07 — Test chỉ chạy ở local.** Jest test (`__tests__/`) chỉ chạy thủ công ở máy dev (`npm test` → `jest`). KHÔNG wire vào CI/pipeline/deploy/git hook. Fixture RBAC (permission/role + ma trận) khai báo ngay trong `__tests__/rbac.integration.test.js` (không còn nguồn seed dùng chung).

**ADR-08 — `kpi_year_plan` do Giám đốc TTKD lập, không phải BOD.**
BRD mô tả F02 có 2 chiều: BOD giao KPI năm (offline/tham chiếu) và GĐ TTKD phân bổ xuống 12 tháng. Quyết định: `kpi_year_plan` là kế hoạch của GĐ TTKD cho TTKD mình — `created_by` trỏ về account GĐ TTKD, permission `kpi.year_plan.allocate`. BOD không có model riêng ở phase này; nếu cần sau thêm model `kpi_bod_target` riêng.

**ADR-09 — `algorithm` phân rã không lưu vào DB.**
Algorithm (equal/linear/seasonal) chỉ là công cụ sinh `monthly_targets` lúc tạo. Sau khi sinh xong, GĐ TTKD có thể override từng tháng → `monthly_targets` không còn khớp algorithm nào. Lưu algorithm vào DB gây misleading. Client gửi algorithm + params → server tính → lưu kết quả. Nếu cần recompute, client gửi lại.

**ADR-10 — `kpi_period_target` dùng `scope_type` + `scope_id` thay vì 2 field riêng.**
Polymorphic ref: `scope_type="ttkd"` → `scope_id` là `department._id`; `scope_type="sale"` → `scope_id` là `user_info._id`. Tránh nullable field (`ttkd_id` null khi scope=sale và ngược lại). Index compound `{scope_type, scope_id, metric_code, period_type, period_key}` đảm bảo unique và query hiệu quả.

---

## 9. Nhật ký tiến độ (cập nhật mỗi khi xong 1 task)

> Mỗi dòng: `YYYY-MM-DD — [phase/task] — nội dung đã làm — file liên quan`.

- 2026-06-24 — [Phase 0] — Khảo sát BRD + codebase/DB, viết tài liệu kế hoạch & phân rã việc — `docs/KPI-PLAN.md`.
- 2026-06-24 — [Phase 0] — Dựng nền RBAC cho KPI (5 model + resolver `can()` + middleware `requirePermission` + API admin `/rbac`). — `src/models/{Permission,Role,RolePermission,UserRole,UserPermission}Model.js`, `src/helpers/rbac.js` + `rbacResolve.js`, `src/controllers/RbacController.js`, `src/routes/rbac.js`. Mã quyền/role ở `src/constants/{permissions,roles}.js`.
- 2026-06-24 — [Phase 0] — **Bỏ seed-as-code** (ADR-06): xóa `src/config/rbacDefinitions.js` + `src/jobs/seedRbac.js`. Chuyển test sang **jest** ở `__tests__/` (chỉ chạy local — ADR-07). Sửa `rbac.integration.test.js` tự khai báo fixture (không còn require `rbacDefinitions`). `package.json` → `"test": "jest"`. — `__tests__/*.test.js`, `package.json`.
- 2026-06-24 — [Phase 0] — Bổ sung đủ **6 TTKD** (quyết định: đủ 6 ngay, `type:"branch"` dưới `KHOI-CN`). Thêm `TTKD-PRIORITY`, `TTKD-ONLINE`, `TTKD-PARTNER` (chức năng, không address) vào cây tổ chức. ✅ Đã chạy `node scripts/seedOrgTree.js` — DB có đủ 6 TTKD. — `scripts/seedOrgTree.js`.
- 2026-06-25 — [Phase 1/F01] — `kpi_metric` model + CRUD (catalog chỉ tiêu động). `code` immutable (chặn sửa ở update), validate quan hệ `source`↔`auto_source`, soft delete + `is_active` tắt mềm. Đọc cần `authenticate`, ghi cần `kpi.metric.manage`. Mount `/kpi/metrics`. — `src/constants/kpi.js`, `src/models/KpiMetricModel.js`, `src/controllers/KpiMetricController.js`, `src/routes/kpiMetric.js`, đăng ký ở `src/routes/index.js` + `src/constants/index.js`.
- 2026-06-29 — [Phase 1/F03] — `kpi_assignment` model + controller + route đầy đủ. Flow draft→active→superseded, versioning, transaction khi activate (supersede bản cũ), validate metric_code active, soft delete draft-only. Mount `/kpi/assignments`. — `src/models/KpiAssignmentModel.js`, `src/controllers/KpiAssignmentController.js`, `src/routes/kpiAssignment.js`.
- 2026-06-29 — [Phase 1 — DB] — Tạo đủ 6 model KPI còn lại + cập nhật constants. Schema đã chốt, index đầy đủ. ADR-08/09/10 ghi lý do thiết kế. — `src/models/{KpiYearPlan,KpiPeriodTarget,KpiDailyReport,KpiAdjustment,KpiTierConfig,KpiTierAssignment}Model.js`, `src/constants/kpi.js`.
