import mongoose from "mongoose";

function toObjectIdIfValid(value: unknown): unknown {
  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
}

export function castObjectIdFields(
  condition: Record<string, unknown>,
  objectIdFields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(condition)) {
    if ((key === "$or" || key === "$and" || key === "$nor") && Array.isArray(value)) {
      result[key] = value.map((clause) =>
        castObjectIdFields(clause as Record<string, unknown>, objectIdFields)
      );
      continue;
    }

    if (objectIdFields.includes(key) && value && typeof value === "object") {
      const operatorObject = value as Record<string, unknown>;
      const castedOperatorObject: Record<string, unknown> = {};
      for (const [operator, operatorValue] of Object.entries(operatorObject)) {
        castedOperatorObject[operator] = Array.isArray(operatorValue)
          ? operatorValue.map(toObjectIdIfValid)
          : toObjectIdIfValid(operatorValue);
      }
      result[key] = castedOperatorObject;
      continue;
    }

    if (objectIdFields.includes(key)) {
      result[key] = toObjectIdIfValid(value);
      continue;
    }

    result[key] = value;
  }

  return result;
}
