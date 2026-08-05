export interface ShiftInfo {
  start_time: string;
  end_time: string;
}

export interface WorksheetSnapshot {
  check_in: Date | string | null;
  check_out: Date | string | null;
  minutes_late?: number;
  minute_early?: number;
  work_unit?: number | null;
  penalty_amount?: number;
  shifts?: ShiftInfo[];
}

export interface ForgotInfo {
  type: "check_in" | "check_out" | "both";
}

export interface ForgotOccurrenceInfo {
  occurrence: number;
  hasRequest: boolean;
}

export interface PenaltyOutcome {
  work_unit: number;
  penalty_amount: number;
  morning_absent?: boolean;
  afternoon_absent?: boolean;
}

export type PenaltyResolver = (
  dayStart: Date,
  minutesOrCount: number,
  isSaturday: boolean
) => PenaltyOutcome;
