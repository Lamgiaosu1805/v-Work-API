export type WorkDayStatus =
  | "pending"
  | "present"
  | "missed_clock"
  | "absent"
  | "leave_paid"
  | "leave_unpaid"
  | "remote"
  | "business_trip"
  | "client_visit";

interface StatusClassification {
  driver: "attendance" | "decision";
  setsSyntheticAttendance?: boolean;
}

const WORK_DAY_STATUS_CLASSIFICATION: Record<WorkDayStatus, StatusClassification> = {
  pending: { driver: "attendance" },
  present: { driver: "attendance" },
  missed_clock: { driver: "attendance" },
  absent: { driver: "attendance" },
  leave_paid: { driver: "decision", setsSyntheticAttendance: false },
  leave_unpaid: { driver: "decision", setsSyntheticAttendance: false },
  remote: { driver: "decision", setsSyntheticAttendance: true },
  business_trip: { driver: "decision", setsSyntheticAttendance: true },
  client_visit: { driver: "decision", setsSyntheticAttendance: true }
};

function statusesWhere(
  predicate: (entry: StatusClassification) => boolean | undefined
): WorkDayStatus[] {
  return (Object.keys(WORK_DAY_STATUS_CLASSIFICATION) as WorkDayStatus[]).filter((status) =>
    predicate(WORK_DAY_STATUS_CLASSIFICATION[status])
  );
}

export const ATTENDANCE_DRIVEN_STATUSES = statusesWhere((entry) => entry.driver === "attendance");

export const DECISION_DRIVEN_STATUSES = statusesWhere((entry) => entry.driver === "decision");

export const STATUSES_WITH_SYNTHETIC_ATTENDANCE = statusesWhere(
  (entry) => entry.setsSyntheticAttendance
);

export { WORK_DAY_STATUS_CLASSIFICATION };
