import moment from "moment-timezone";
import {
  calculateMinutesLate,
  calculateMinutesEarly
} from "../../../src/modules/attendance/domain/naive-punch-timing";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01";

describe("calculateMinutesLate", () => {
  test("check-in đúng giờ ca (08:00): 0 phút muộn", () => {
    const now = moment.tz(`${DATE_KEY} 08:00`, "YYYY-MM-DD HH:mm", TZ).toDate();
    expect(calculateMinutesLate(now, DATE_KEY, "08:00")).toBe(0);
  });

  test("check-in muộn 20 phút (08:20, ca 08:00): 20 phút muộn", () => {
    const now = moment.tz(`${DATE_KEY} 08:20`, "YYYY-MM-DD HH:mm", TZ).toDate();
    expect(calculateMinutesLate(now, DATE_KEY, "08:00")).toBe(20);
  });

  test("check-in sớm hơn giờ ca (07:50, ca 08:00): 0 phút muộn (không âm)", () => {
    const now = moment.tz(`${DATE_KEY} 07:50`, "YYYY-MM-DD HH:mm", TZ).toDate();
    expect(calculateMinutesLate(now, DATE_KEY, "08:00")).toBe(0);
  });
});

describe("calculateMinutesEarly", () => {
  test("check-out đúng giờ tan ca (17:30): 0 phút sớm", () => {
    const now = moment.tz(`${DATE_KEY} 17:30`, "YYYY-MM-DD HH:mm", TZ).toDate();
    expect(calculateMinutesEarly(now, DATE_KEY, "17:30")).toBe(0);
  });

  test("check-out sớm 20 phút (17:10, ca tan 17:30): 20 phút sớm", () => {
    const now = moment.tz(`${DATE_KEY} 17:10`, "YYYY-MM-DD HH:mm", TZ).toDate();
    expect(calculateMinutesEarly(now, DATE_KEY, "17:30")).toBe(20);
  });

  test("check-out muộn hơn giờ tan ca (17:40, ca tan 17:30): 0 phút sớm (không âm)", () => {
    const now = moment.tz(`${DATE_KEY} 17:40`, "YYYY-MM-DD HH:mm", TZ).toDate();
    expect(calculateMinutesEarly(now, DATE_KEY, "17:30")).toBe(0);
  });
});
