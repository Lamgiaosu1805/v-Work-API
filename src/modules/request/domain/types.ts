export type RequestType =
  | "leave"
  | "late_early"
  | "remote"
  | "business_trip"
  | "client_visit"
  | "explanation"
  | "forgot_checkin";

export interface Approval {
  account: string;
  reviewed_at: Date;
}

export interface ReviewerProfile {
  userInfoId: unknown;
  full_name: string;
  position_name: string | null;
  department_name: string | null;
}

export interface RequestTypeHandler {
  validate: (...args: any[]) => any;
  validateAsync: (...args: any[]) => any;
  onCreate?: (...args: any[]) => any;
  onApprove?: (...args: any[]) => any;
  onReject?: (...args: any[]) => any;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface RequestProps {
  user_id: string;
  request_type: RequestType;
  reason: string;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  reviewer_note: string;
  approvals: Approval[];
  from_date?: Date;
  from_period?: "morning" | "afternoon";
  to_date?: Date;
  to_period?: "morning" | "afternoon";
  total_days?: number;
  leave_type?: "paid" | "unpaid";
  paid_days?: number;
  unpaid_days?: number;
  date?: Date;
  shift_id?: string;
  type?: string;
  minutes?: number;
  occurrence?: number | null;
  content?: string;
  expected_check_in?: Date | null;
  expected_check_out?: Date | null;
}
