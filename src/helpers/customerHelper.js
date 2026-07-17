const crypto = require("crypto");
const { default: mongoose } = require("mongoose");
const AppModel = require("../models/AppModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const InvestmentModel = require("../models/InvestmentModel");
const AgentModel = require("../models/AgentModel");

const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  const combined = Buffer.from(encryptedText, "base64");

  const iv = combined.slice(0, 12);
  const authTag = combined.slice(combined.length - 16);
  const encrypted = combined.slice(12, combined.length - 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.SECRET_KEY_DECRYPT),
    iv
  );

  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};

async function buildCustomerPipeline(req, query) {
  const {
    status,
    search,
    app_code,
    source_type,
    from_date,
    to_date,
    branch_id,
    funnel_status,
    behavior,
    role_type,
    sale_ids
  } = query;

  const parseMulti = (value) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && item !== "all");
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const initialMatch = { isDeleted: false };

  if (status && status !== "all") initialMatch.status = status;
  if (source_type && source_type !== "all") initialMatch.source_type = source_type;

  if (app_code) {
    console.log("App code: ", app_code);

    const app = await AppModel.findOne({ code: app_code, is_active: true });
    if (!app) {
      const err = new Error("Ứng dụng không tồn tại hoặc đã bị khóa");
      err.statusCode = 404;
      throw err;
    }
    initialMatch.app_id = app._id;
  }

  if (search) {
    const safeSearch = escapeRegex(String(search).trim().slice(0, 100));
    initialMatch.$or = [
      { phone_number: { $regex: safeSearch, $options: "i" } },
      { "identity.full_name": { $regex: safeSearch, $options: "i" } },
      { external_id: { $regex: safeSearch, $options: "i" } }
    ];
  }

  let scopedSaleIds = null;
  if (req.account.role !== "admin" && req.account.dept_scope !== "all") {
    const manager = await UserInfoModel.findOne({
      id_account: req.account._id,
      isDeleted: false
    })
      .select("_id")
      .lean();
    if (!manager) {
      const err = new Error("Không tìm thấy thông tin người quản lý");
      err.statusCode = 404;
      throw err;
    }
    const departmentIds = await UserDepartmentPositionModel.distinct("department", {
      user: manager._id,
      isDeleted: false
    });
    scopedSaleIds = await UserDepartmentPositionModel.distinct("user", {
      department: { $in: departmentIds },
      isDeleted: false
    });
  }

  const pipeline = [
    { $match: initialMatch },
    {
      $lookup: {
        from: InvestmentModel.collection.name,
        let: { customerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$customer_id", "$$customerId"] }, { $eq: ["$isDeleted", false] }]
              }
            }
          },
          { $project: { product_name: 1, status: 1, invested_at: 1 } }
        ],
        as: "investments"
      }
    },
    {
      $lookup: {
        from: UserInfoModel.collection.name,
        localField: "referred_by",
        foreignField: "_id",
        as: "referredSale"
      }
    },
    {
      $lookup: {
        from: AgentModel.collection.name,
        localField: "agent_id",
        foreignField: "_id",
        as: "agentInfo"
      }
    },
    {
      $lookup: {
        from: AppModel.collection.name,
        localField: "app_id",
        foreignField: "_id",
        as: "appInfo"
      }
    },
    {
      $addFields: {
        referred_by: { $arrayElemAt: ["$referredSale", 0] },
        agent_id: { $arrayElemAt: ["$agentInfo", 0] },
        app_id: { $arrayElemAt: ["$appInfo", 0] },
        investment_count: { $size: "$investments" },
        products: { $setUnion: ["$investments.product_name", []] },
        active_investments: {
          $filter: {
            input: "$investments",
            as: "investment",
            cond: { $eq: ["$$investment.status", "active"] }
          }
        },
        settled_investments: {
          $filter: {
            input: "$investments",
            as: "investment",
            cond: { $in: ["$$investment.status", ["matured", "early_terminated"]] }
          }
        }
      }
    },
    {
      $addFields: {
        latest_active_at: { $max: "$active_investments.invested_at" },
        latest_settled_at: { $max: "$settled_investments.invested_at" },
        status_tags: {
          $concatArrays: [
            {
              $cond: [
                { $eq: [{ $ifNull: ["$identity.verified_at", null] }, null] },
                ["not_kyc"],
                []
              ]
            },
            {
              $cond: [
                { $ne: [{ $ifNull: ["$identity.verified_at", null] }, null] },
                ["kyc_verified"],
                []
              ]
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ["$identity.verified_at", null] }, null] },
                    { $eq: ["$investment_count", 0] }
                  ]
                },
                ["kyc_verified_no_investment"],
                []
              ]
            },
            {
              $cond: [{ $gt: [{ $size: "$active_investments" }, 0] }, ["active_investor"], []]
            },
            { $cond: [{ $gt: [{ $size: "$settled_investments" }, 0] }, ["settled"], []] }
          ]
        },
        behavior_tags: {
          $concatArrays: [
            { $cond: [{ $gt: ["$investment_count", { $size: "$products" }] }, ["upsale"], []] },
            { $cond: [{ $gte: [{ $size: "$products" }, 2] }, ["cross_sale"], []] }
          ]
        },
        role_tags: {
          $cond: [
            { $ne: [{ $ifNull: ["$agent_id", null] }, null] },
            [
              {
                $cond: [{ $eq: ["$agent_id.agent_type", "ENTERPRISE"] }, "agent", "collaborator"]
              }
            ],
            []
          ]
        }
      }
    }
  ];

  const advancedMatch = {};
  const funnelStatuses = parseMulti(funnel_status);
  const behaviors = parseMulti(behavior);
  const roleTypes = parseMulti(role_type);
  const selectedSaleIds = parseMulti(sale_ids)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (funnelStatuses.length) advancedMatch.status_tags = { $in: funnelStatuses };
  if (behaviors.length) advancedMatch.behavior_tags = { $in: behaviors };
  if (roleTypes.length) advancedMatch.role_tags = { $in: roleTypes };
  if (branch_id && mongoose.Types.ObjectId.isValid(branch_id))
    advancedMatch["referred_by.branch_id"] = new mongoose.Types.ObjectId(branch_id);
  if (selectedSaleIds.length) advancedMatch["referred_by._id"] = { $in: selectedSaleIds };
  if (scopedSaleIds) {
    advancedMatch.$or = [{ "referred_by._id": { $in: scopedSaleIds } }, { referred_by: null }];
  }
  if (Object.keys(advancedMatch).length) pipeline.push({ $match: advancedMatch });

  if (from_date || to_date) {
    const dateCondition = {
      ...(from_date ? { $gte: new Date(from_date) } : {}),
      ...(to_date ? { $lte: new Date(to_date) } : {})
    };
    if (Object.values(dateCondition).some((date) => Number.isNaN(date.getTime()))) {
      const err = new Error("Khoảng thời gian không hợp lệ");
      err.statusCode = 400;
      throw err;
    }
    const eventMatches = [];
    if (!funnelStatuses.length || funnelStatuses.includes("not_kyc"))
      eventMatches.push({ createdAt: dateCondition });
    if (funnelStatuses.includes("kyc_verified"))
      eventMatches.push({ "identity.verified_at": dateCondition });
    if (funnelStatuses.includes("kyc_verified_no_investment"))
      eventMatches.push({ "identity.verified_at": dateCondition });
    if (funnelStatuses.includes("active_investor"))
      eventMatches.push({ latest_active_at: dateCondition });
    if (funnelStatuses.includes("settled")) eventMatches.push({ latest_settled_at: dateCondition });
    pipeline.push({
      $match: eventMatches.length === 1 ? eventMatches[0] : { $or: eventMatches }
    });
  }

  return pipeline;
}

module.exports = {
  decrypt,
  buildCustomerPipeline
};
