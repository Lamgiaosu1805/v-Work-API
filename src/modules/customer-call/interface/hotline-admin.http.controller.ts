import { Request, Response } from "express";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { listHotlines } from "../application/list-hotlines.service";
import { getHotlineDetail } from "../application/get-hotline-detail.service";
import {
  updateHotlineConfig,
  HotlineAccessType
} from "../application/update-hotline-config.service";
import { listHotlineCallScripts } from "../application/list-hotline-call-scripts.service";
import { listHotlineExtensions } from "../application/list-hotline-extensions.service";

export const hotlineAdminHttpController = {
  async getHotlines(req: Request, res: Response) {
    const { page, size, keyword } = req.query;
    const data = await listHotlines({
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
      keyword: keyword as string | undefined
    });
    return res.status(200).json({ message: "OK", data });
  },

  async getHotlineDetail(req: Request, res: Response) {
    const data = await getHotlineDetail(req.params.phone);
    return res.status(200).json({ message: "OK", data });
  },

  async updateHotlineConfig(req: Request, res: Response) {
    const { allowCallIn, allowCallOut, accessType, callScript, extensions, groupIds } = req.body;
    if (typeof allowCallIn !== "boolean" || typeof allowCallOut !== "boolean") {
      throw new ArgumentInvalidException("allowCallIn/allowCallOut phải là boolean");
    }
    await updateHotlineConfig(req.params.phone, {
      allowCallIn,
      allowCallOut,
      accessType: accessType as HotlineAccessType,
      callScript,
      extensions,
      groupIds
    });
    return res.status(200).json({ message: `Đã cập nhật cấu hình ${req.params.phone}` });
  },

  async getHotlineCallScripts(req: Request, res: Response) {
    const data = await listHotlineCallScripts();
    return res.status(200).json({ message: "OK", data });
  },

  async getHotlineExtensions(req: Request, res: Response) {
    const data = await listHotlineExtensions({ keyword: req.query.keyword as string | undefined });
    return res.status(200).json({ message: "OK", data });
  }
};
