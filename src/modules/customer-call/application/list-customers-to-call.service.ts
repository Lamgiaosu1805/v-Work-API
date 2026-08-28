import mongoose from "mongoose";
import { Ability, toMongoQuery } from "../../permission";
import CustomerModel from "../../../models/CustomerModel";
import AppModel from "../../../models/AppModel";
import CustomerCallStatsModel from "../../../models/CustomerCallStatsModel";
import CustomerSaleRelationshipModel from "../../../models/CustomerSaleRelationshipModel";
import InvestmentModel from "../../../models/InvestmentModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";
import { normalizePhoneNumber } from "../domain/normalize-phone-number";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";

const SETTLED_INVESTMENT_STATUSES = ["matured", "early_terminated"];

export type DerivedCustomerStatus =
  | "chua_ekyc"
  | "ekyc_chua_dt"
  | "dang_dau_tu"
  | "da_tat_toan"
  | "khac";

export interface ListCustomersToCallFilters extends PaginationQuery {
  appCode?: string;
  status?: DerivedCustomerStatus;
  relationshipStatus?: string;
  callCount?: number;
  search?: string;
}

export interface ListCustomersToCallResult {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
}

export async function listCustomersToCall(
  ability: Ability,
  filters: ListCustomersToCallFilters
): Promise<ListCustomersToCallResult> {
  const { page, limit, skip } = parsePagination(filters);
  const scopeFilter = castObjectIdFields(toMongoQuery(ability, "customer_call.view", "Customer"), [
    "referred_by"
  ]);

  const andConditions: Record<string, unknown>[] = [scopeFilter, { isDeleted: false }];
  if (filters.appCode) {
    const app = await AppModel.findOne({ code: filters.appCode, is_active: true }).lean();
    if (!app) {
      throw new NotFoundException("Ứng dụng không tồn tại hoặc đã bị khóa");
    }
    andConditions.push({ app_id: (app as { _id: unknown })._id });
  }
  if (filters.search) {
    const normalizedSearch = normalizePhoneNumber(filters.search);
    const searchOr: Record<string, unknown>[] = [
      { "identity.full_name": { $regex: filters.search, $options: "i" } }
    ];
    if (normalizedSearch) {
      searchOr.push({ phone_number: { $regex: normalizedSearch, $options: "i" } });
    }
    andConditions.push({ $or: searchOr });
  }
  const matchStage: Record<string, unknown> = { $and: andConditions };

  const pipeline: mongoose.PipelineStage[] = [
    { $match: matchStage },
    {
      $lookup: {
        from: CustomerCallStatsModel.collection.name,
        localField: "_id",
        foreignField: "customer_id",
        as: "stats"
      }
    },
    { $unwind: { path: "$stats", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: CustomerSaleRelationshipModel.collection.name,
        let: { customerId: "$_id", saleId: "$referred_by" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$customer_id", "$$customerId"] },
                  { $eq: ["$sale_id", "$$saleId"] },
                  { $eq: ["$isDeleted", false] }
                ]
              }
            }
          }
        ],
        as: "relationship"
      }
    },
    { $unwind: { path: "$relationship", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: InvestmentModel.collection.name,
        localField: "_id",
        foreignField: "customer_id",
        as: "investments"
      }
    },
    {
      $lookup: {
        from: UserInfoModel.collection.name,
        localField: "referred_by",
        foreignField: "_id",
        as: "saleInfo"
      }
    },
    { $unwind: { path: "$saleInfo", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        callCount: { $ifNull: ["$stats.call_count", 0] },
        lastContactedAt: { $ifNull: ["$stats.last_contacted_at", null] },
        relationshipStatus: { $ifNull: ["$relationship.status", "not_friended"] },
        saleName: { $ifNull: ["$saleInfo.full_name", null] },
        isVerified: { $ne: [{ $ifNull: ["$identity.verified_at", null] }, null] },
        hasAnyInvestment: { $gt: [{ $size: "$investments" }, 0] },
        hasActiveInvestment: {
          $anyElementTrue: {
            $map: {
              input: "$investments",
              as: "inv",
              in: { $eq: ["$$inv.status", "active"] }
            }
          }
        },
        hasSettledInvestment: {
          $anyElementTrue: {
            $map: {
              input: "$investments",
              as: "inv",
              in: { $in: ["$$inv.status", SETTLED_INVESTMENT_STATUSES] }
            }
          }
        }
      }
    },
    {
      $addFields: {
        derivedStatus: {
          $switch: {
            branches: [
              { case: { $eq: ["$isVerified", false] }, then: "chua_ekyc" },
              { case: { $eq: ["$hasActiveInvestment", true] }, then: "dang_dau_tu" },
              { case: { $eq: ["$hasSettledInvestment", true] }, then: "da_tat_toan" },
              { case: { $eq: ["$hasAnyInvestment", false] }, then: "ekyc_chua_dt" }
            ],
            default: "khac"
          }
        }
      }
    }
  ];

  const postLookupMatch: Record<string, unknown> = {};
  if (filters.status) postLookupMatch.derivedStatus = filters.status;
  if (filters.relationshipStatus) postLookupMatch.relationshipStatus = filters.relationshipStatus;
  if (filters.callCount !== undefined) postLookupMatch.callCount = filters.callCount;
  if (Object.keys(postLookupMatch).length > 0) {
    pipeline.push({ $match: postLookupMatch });
  }

  pipeline.push({
    $facet: {
      data: [
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            phone_number: 1,
            "identity.full_name": 1,
            derivedStatus: 1,
            referred_by: 1,
            saleName: 1,
            callCount: 1,
            lastContactedAt: 1,
            relationshipStatus: 1
          }
        }
      ],
      totalCount: [{ $count: "count" }]
    }
  });

  const [result] = await CustomerModel.aggregate(pipeline);

  return {
    data: result?.data ?? [],
    total: result?.totalCount?.[0]?.count ?? 0,
    page,
    limit
  };
}
