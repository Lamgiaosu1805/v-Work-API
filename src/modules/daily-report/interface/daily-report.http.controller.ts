import { Request, Response } from "express";
import { resolveEmployeeId } from "../../../core/authorization/resolve-employee-id";
import { parseDateKey, toDateKey } from "../domain/report-calendar";
import {
  getDailyReportSummary,
  getMyDailyReport,
  saveMyDailyReportPlan,
  submitMyDailyReportResult
} from "../../../workflows/daily-report-board.workflow";

const dateOf = (req: Request, now: Date) =>
  req.query.date ? parseDateKey(String(req.query.date)) : toDateKey(now);

const appCodeOf = (req: Request) =>
  (req.query.app_code || req.body?.app_code || undefined) as string | undefined;

export const dailyReportHttpController = {
  async getMine(req: Request, res: Response) {
    const now = new Date();
    const data = await getMyDailyReport({
      employeeId: await resolveEmployeeId(req.account!._id),
      dateKey: dateOf(req, now),
      now,
      appCode: appCodeOf(req)
    });
    return res.status(200).json({ message: "OK", data });
  },

  async savePlan(req: Request, res: Response) {
    const data = await saveMyDailyReportPlan({
      employeeId: await resolveEmployeeId(req.account!._id),
      now: new Date(),
      appCode: appCodeOf(req),
      body: { targets: req.body?.targets, note: req.body?.note }
    });
    return res.status(200).json({ message: "Đã lưu kế hoạch ngày", data });
  },

  async submitResult(req: Request, res: Response) {
    const data = await submitMyDailyReportResult({
      employeeId: await resolveEmployeeId(req.account!._id),
      now: new Date(),
      appCode: appCodeOf(req),
      body: {
        values: req.body?.values,
        achievements: req.body?.achievements,
        blockers: req.body?.blockers,
        proposals: req.body?.proposals
      }
    });
    return res.status(200).json({ message: "Đã nộp kết quả ngày", data });
  },

  async getSummary(req: Request, res: Response) {
    const now = new Date();
    const data = await getDailyReportSummary({
      ability: req.permissionAbility!,
      dateKey: dateOf(req, now),
      now,
      appCode: appCodeOf(req)
    });
    return res.status(200).json({ message: "OK", data });
  }
};
