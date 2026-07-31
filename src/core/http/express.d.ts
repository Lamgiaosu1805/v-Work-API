export interface RequestAccount {
  _id: string;
  username?: string;
  role?: string;
  module_access?: string[];
  dept_scope?: string;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      account?: RequestAccount;
    }
  }
}
