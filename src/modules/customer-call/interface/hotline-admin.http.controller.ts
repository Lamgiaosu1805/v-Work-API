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
import { listHotlineRingGroups } from "../application/list-hotline-ring-groups.service";
import { listInternalGroups } from "../application/list-internal-groups.service";
import { deleteInternalGroup } from "../application/delete-internal-group.service";
import { addInternalGroupMember } from "../application/add-internal-group-member.service";
import { removeInternalGroupMember } from "../application/remove-internal-group-member.service";
import { syncHotlineExtensionAssignments } from "../application/sync-hotline-extension-assignments.service";

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
  },

  async getHotlineRingGroups(req: Request, res: Response) {
    const data = await listHotlineRingGroups({ keyword: req.query.keyword as string | undefined });
    return res.status(200).json({ message: "OK", data });
  },

  async getInternalGroups(req: Request, res: Response) {
    const data = await listInternalGroups({ keyword: req.query.keyword as string | undefined });
    return res.status(200).json({ message: "OK", data });
  },

  async deleteInternalGroup(req: Request, res: Response) {
    await deleteInternalGroup(req.params.id);
    return res.status(200).json({ message: "Đã xoá nhóm nội bộ" });
  },

  async addInternalGroupMember(req: Request, res: Response) {
    const { sipUser } = req.body;
    if (!sipUser || typeof sipUser !== "string") {
      throw new ArgumentInvalidException("sipUser là bắt buộc");
    }
    await addInternalGroupMember(req.params.id, sipUser);
    return res.status(200).json({ message: "Đã thêm nhân viên vào nhóm nội bộ" });
  },

  async removeInternalGroupMember(req: Request, res: Response) {
    await removeInternalGroupMember(req.params.id, req.params.sipUser);
    return res.status(200).json({ message: "Đã xoá nhân viên khỏi nhóm nội bộ" });
  },

  async syncHotlineExtensionAssignments(req: Request, res: Response) {
    const { extensionsToAssign, extensionsToUnassign } = req.body;
    if (!Array.isArray(extensionsToAssign) || !Array.isArray(extensionsToUnassign)) {
      throw new ArgumentInvalidException("extensionsToAssign/extensionsToUnassign phải là mảng");
    }
    const data = await syncHotlineExtensionAssignments(
      req.params.phone,
      extensionsToAssign,
      extensionsToUnassign
    );
    return res.status(200).json({ message: "Đã đồng bộ gán hotline cho extension", data });
  }
};
