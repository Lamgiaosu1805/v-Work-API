// Tính deadline để sale gửi yêu cầu nhận khách
// Rule: 4 tiếng từ lúc đăng ký, trong giờ làm việc (8:00–17:00)
// Nếu vượt qua 17:00 → hôm sau 10:00 (ngày làm việc tiếp theo)

function getNextWorkingDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6); // bỏ CN (0) và T7 (6)
    return d;
}

function computeClaimWindow(createdAt) {
    const created = new Date(createdAt);
    const day = created.getDay(); // 0=CN, 6=T7
    const hours = created.getHours();
    const minutes = created.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const WORK_START = 8 * 60;   // 480 phút
    const CUTOFF = 13 * 60;      // 780 phút — sau 13:00 sẽ vượt 17:00 nếu cộng 4h
    const WINDOW = 4 * 60;       // 240 phút

    // Cuối tuần → thứ 2 10:00
    if (day === 0 || day === 6) {
        const nextMonday = getNextWorkingDay(day === 6 ? created : (() => {
            const d = new Date(created);
            d.setDate(d.getDate() - 1); // lùi về T7 để getNextWorkingDay tính T2
            return d;
        })());
        // Đơn giản hơn: tìm thứ 2 tiếp theo
        const d = new Date(created);
        while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
        d.setHours(10, 0, 0, 0);
        return d;
    }

    // Trước 8:00 → cùng ngày 12:00 (8:00 + 4h)
    if (totalMinutes < WORK_START) {
        const deadline = new Date(created);
        deadline.setHours(12, 0, 0, 0);
        return deadline;
    }

    // 8:00 – 13:00 → giờ đăng ký + 4 tiếng (nằm trong giờ làm)
    if (totalMinutes <= CUTOFF) {
        const deadline = new Date(created);
        deadline.setMinutes(deadline.getMinutes() + WINDOW);
        return deadline;
    }

    // 13:01 – 23:59 → ngày làm việc tiếp theo 10:00
    const nextDay = getNextWorkingDay(created);
    nextDay.setHours(10, 0, 0, 0);
    return nextDay;
}

module.exports = { computeClaimWindow };
