import { OmicallClient } from "../../../utils/omicallClient";
import { ArgumentInvalidException, ConflictException } from "../../../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export type HotlineAccessType =
  | "applies_to_all_employees"
  | "applies_according_to_employee_criteria";

const VALID_ACCESS_TYPES: HotlineAccessType[] = [
  "applies_to_all_employees",
  "applies_according_to_employee_criteria"
];

export interface UpdateHotlineConfigInput {
  allowCallIn: boolean;
  allowCallOut: boolean;
  accessType: HotlineAccessType;
  callScript?: string;
  extensions?: string[];
  groupIds?: string[];
}

export async function updateHotlineConfig(
  phone: string,
  input: UpdateHotlineConfigInput
): Promise<void> {
  if (!VALID_ACCESS_TYPES.includes(input.accessType)) {
    throw new ArgumentInvalidException("accessType không hợp lệ");
  }
  if (
    input.accessType === "applies_according_to_employee_criteria" &&
    !(input.extensions && input.extensions.length > 0) &&
    !(input.groupIds && input.groupIds.length > 0)
  ) {
    throw new ArgumentInvalidException(
      "Cần chọn ít nhất 1 nhân viên hoặc nhóm khi phạm vi là Theo phân quyền cụ thể"
    );
  }

  let succeeded: boolean;
  try {
    succeeded = await omicallClient.updateHotlineConfig({
      hotline: phone,
      allow_call_in: String(input.allowCallIn),
      allow_call_out: String(input.allowCallOut),
      access_type: input.accessType,
      ...(input.callScript ? { call_script: input.callScript } : {}),
      ...(input.extensions ? { extensions: input.extensions } : {}),
      ...(input.groupIds ? { group_ids: input.groupIds } : {})
    });
  } catch (error) {
    throw new ConflictException("Cập nhật cấu hình thất bại, vui lòng thử lại", {
      metadata: { hotline: phone, cause: (error as Error).message }
    });
  }

  if (!succeeded) {
    throw new ConflictException("Cập nhật cấu hình thất bại, vui lòng thử lại", {
      metadata: { hotline: phone, cause: "Omicall trả về payload=false" }
    });
  }
}
