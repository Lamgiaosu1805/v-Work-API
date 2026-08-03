import AttendancePenaltyModel from "../../../models/AttendancePenaltyModel";
import {
  PenaltyTier,
  PenaltyTierType,
  resolveLatePenaltyFromTiers,
  resolveEarlyPenaltyFromTiers,
  resolveForgotPenaltyFromTiers
} from "../domain/penalty-tier";
import { PenaltyResolver } from "../domain/types";

export class PenaltyPolicyRepository {
  // eslint-disable-next-line class-methods-use-this
  private async findActiveTiers(type: PenaltyTierType): Promise<PenaltyTier[]> {
    const sortKey = type === "forgot" ? "from_count" : "from_minutes";
    const docs = await AttendancePenaltyModel.find({
      type,
      is_active: true,
      isDeleted: false
    })
      .sort({ effective_from: -1, [sortKey]: 1 })
      .lean();
    return docs as unknown as PenaltyTier[];
  }

  async buildLatePenaltyResolver(): Promise<PenaltyResolver> {
    const tiers = await this.findActiveTiers("late");
    return (dayStart, minutesLate, isSaturday) =>
      resolveLatePenaltyFromTiers(tiers, dayStart, minutesLate, isSaturday);
  }

  async buildEarlyPenaltyResolver(): Promise<PenaltyResolver> {
    const tiers = await this.findActiveTiers("early");
    return (dayStart, minutesEarly, isSaturday) =>
      resolveEarlyPenaltyFromTiers(tiers, dayStart, minutesEarly, isSaturday);
  }

  async buildForgotPenaltyResolver(): Promise<PenaltyResolver> {
    const tiers = await this.findActiveTiers("forgot");
    return (dayStart, count, isSaturday) =>
      resolveForgotPenaltyFromTiers(tiers, dayStart, count, isSaturday);
  }
}
