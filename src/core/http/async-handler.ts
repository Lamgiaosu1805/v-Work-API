import { Request, Response, NextFunction } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).then(
      () => undefined,
      (error) => next(error)
    );
}
