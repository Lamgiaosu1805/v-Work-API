import mongoose from "mongoose";
import { Ability, toMongoQuery } from "../../permission";
import CallLogModel from "../../../models/CallLogModel";
import CustomerModel from "../../../models/CustomerModel";
import UserInfoModel from "../../../models/UserInfoModel";
import AppModel from "../../../models/AppModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";
import { normalizePhoneNumber } from "../domain/normalize-phone-number";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";

export interface ListCallHistoryFilters extends PaginationQuery {
  appCode?: string;
  customerId?: string;
  saleId?: string;
  direction?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  isCallbot?: string;
  botScenario?: string; // "tikluy" | "vnfite" — chỉ có nghĩa khi xem lịch sử callbot
}

const BOT_SCENARIO_ENV_KEY: Record<string, string> = {
  tikluy: "CALLBOT_SCRIPT_TIKLUY",
  vnfite: "CALLBOT_SCRIPT_VNFITE"
};

export interface ListCallHistoryResult {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
}

export async function listCallHistory(
  ability: Ability,
  filters: ListCallHistoryFilters
): Promise<ListCallHistoryResult> {
  const { page, limit, skip } = parsePagination(filters);
  let isCallbot: boolean | undefined;
  if (filters.isCallbot === "true") {
    isCallbot = true;
  } else if (filters.isCallbot === "false") {
    isCallbot = false;
  }

  const scopeFilter = castObjectIdFields(toMongoQuery(ability, "call_log.view", "CallLog"), [
    "sale_id",
    "customer_id"
  ]);

  const andConditions: Record<string, unknown>[] = [scopeFilter, { isDeleted: false }];
  if (filters.customerId && mongoose.Types.ObjectId.isValid(filters.customerId)) {
    andConditions.push({ customer_id: new mongoose.Types.ObjectId(filters.customerId) });
  }
  if (filters.saleId && mongoose.Types.ObjectId.isValid(filters.saleId)) {
    andConditions.push({ sale_id: new mongoose.Types.ObjectId(filters.saleId) });
  }
  if (filters.direction) {
    andConditions.push({ direction: filters.direction });
  }
  if (isCallbot !== undefined) {
    andConditions.push({
      "raw_payload.is_callbot": isCallbot
    });
  }
  const botScriptId = filters.botScenario
    ? process.env[BOT_SCENARIO_ENV_KEY[filters.botScenario] ?? ""]
    : undefined;
  if (botScriptId) {
    andConditions.push({ "raw_payload.callbot_script_id": botScriptId });
  }
  if (filters.fromDate || filters.toDate) {
    andConditions.push({
      time_start_call: {
        ...(filters.fromDate ? { $gte: new Date(filters.fromDate) } : {}),
        ...(filters.toDate
          ? { $lte: new Date(new Date(filters.toDate).setHours(23, 59, 59, 999)) }
          : {})
      }
    });
  }

  const matchStage: Record<string, unknown> = { $and: andConditions };

  const pipeline: mongoose.PipelineStage[] = [
    { $match: matchStage },
    {
      $lookup: {
        from: CustomerModel.collection.name,
        localField: "customer_id",
        foreignField: "_id",
        as: "customer"
      }
    },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: UserInfoModel.collection.name,
        localField: "sale_id",
        foreignField: "_id",
        as: "saleInfo"
      }
    },
    { $unwind: { path: "$saleInfo", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        customerName: { $ifNull: ["$customer.identity.full_name", null] },
        saleName: { $ifNull: ["$saleInfo.full_name", null] },
        // Cuộc gọi callbot không có nhân viên: lấy tên kịch bản và nhãn bot đánh dấu từ payload OmiCall.
        botScriptName: {
          $ifNull: ["$raw_payload.call_bot_script_detail.call_bot_script_name", null]
        },
        botClassifies: {
          $filter: {
            input: {
              $map: {
                input: {
                  $cond: [{ $isArray: "$raw_payload.classifies" }, "$raw_payload.classifies", []]
                },
                as: "item",
                in: { $trim: { input: { $ifNull: ["$$item.name", ""] } } }
              }
            },
            as: "label",
            cond: { $ne: ["$$label", ""] }
          }
        }
      }
    }
  ];

  const postLookupAnd: Record<string, unknown>[] = [];
  if (filters.appCode) {
    const app = await AppModel.findOne({ code: filters.appCode, is_active: true }).lean();
    if (!app) {
      throw new NotFoundException("Ứng dụng không tồn tại hoặc đã bị khóa");
    }
    postLookupAnd.push({ "customer.app_id": (app as { _id: unknown })._id });
  }
  if (filters.search) {
    const normalizedSearch = normalizePhoneNumber(filters.search);
    const searchOr: Record<string, unknown>[] = [
      { customerName: { $regex: filters.search, $options: "i" } }
    ];
    if (normalizedSearch) {
      searchOr.push({ phone_number: { $regex: normalizedSearch, $options: "i" } });
    }
    postLookupAnd.push({ $or: searchOr });
  }
  if (postLookupAnd.length > 0) {
    pipeline.push({ $match: { $and: postLookupAnd } });
  }

  pipeline.push({
    $facet: {
      data: [
        { $sort: { time_start_call: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            direction: 1,
            phone_number: 1,
            customerName: 1,
            saleName: 1,
            botScriptName: 1,
            botClassifies: 1,
            sale_id: 1,
            customer_id: 1,
            duration: 1,
            answer_sec: 1,
            bill_sec: 1,
            call_out_price: 1,
            recording_file_url: 1,
            record_seconds: 1,
            hangup_cause: 1,
            note: 1,
            rating: 1,
            time_start_call: 1
          }
        }
      ],
      totalCount: [{ $count: "count" }]
    }
  });

  const [result] = await CallLogModel.aggregate(pipeline);

  return {
    data: result?.data ?? [],
    total: result?.totalCount?.[0]?.count ?? 0,
    page,
    limit
  };
}

export interface CallHistorySaleOption {
  saleId: string;
  saleName: string;
}

export async function listCallHistorySaleOptions(
  ability: Ability
): Promise<CallHistorySaleOption[]> {
  const scopeFilter = castObjectIdFields(toMongoQuery(ability, "call_log.view", "CallLog"), [
    "sale_id",
    "customer_id"
  ]);

  const pipeline: mongoose.PipelineStage[] = [
    { $match: { $and: [scopeFilter, { isDeleted: false }, { sale_id: { $ne: null } }] } },
    { $group: { _id: "$sale_id" } },
    {
      $lookup: {
        from: UserInfoModel.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "saleInfo"
      }
    },
    { $unwind: "$saleInfo" },
    { $project: { _id: 0, saleId: "$_id", saleName: "$saleInfo.full_name" } },
    { $sort: { saleName: 1 } }
  ];

  return CallLogModel.aggregate(pipeline);
}
