import { NotFoundException } from "../../../core/exceptions/exceptions";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { getHotlineDetail } from "./get-hotline-detail.service";
import { updateHotlineConfig, HotlineAccessType } from "./update-hotline-config.service";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export async function assignExtensionOutboundHotline(
  employeeId: string,
  hotlineNumber: string
): Promise<void> {
  const profile = await saleOmicallProfileRepository.findBySaleId(employeeId);
  if (!profile) {
    throw new NotFoundException("Nhân viên chưa có SIP profile để cấu hình", {
      metadata: { employeeId }
    });
  }
  const sipUser = profile.omicallExtension;

  const detail = await getHotlineDetail(hotlineNumber);
  const { configs } = detail;

  if (configs.access_type === "applies_to_all_employees") {
    return;
  }

  const existingExtensions = (detail.accesses || [])
    .map((access) => access.name)
    .filter((name): name is string => Boolean(name));

  if (existingExtensions.includes(sipUser)) {
    return;
  }

  await updateHotlineConfig(hotlineNumber, {
    allowCallIn: configs.allow_call_in,
    allowCallOut: configs.allow_call_out,
    accessType: "applies_according_to_employee_criteria" as HotlineAccessType,
    callScript: configs.default_script || undefined,
    extensions: [...existingExtensions, sipUser]
  });
}
