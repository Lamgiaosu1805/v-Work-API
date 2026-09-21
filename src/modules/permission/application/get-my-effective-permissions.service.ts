import { resolveEffectiveRules } from "./resolve-effective-ability.service";
import { buildAbility } from "../infrastructure/casl-ability.factory";

export async function getMyEffectivePermissions(employeeId: string): Promise<string[]> {
  const rawRules = await resolveEffectiveRules(employeeId);
  const ability = buildAbility(rawRules);

  const pairs = new Set(rawRules.map((rule) => `${rule.action}::${rule.subject}`));

  const allowed: string[] = [];
  pairs.forEach((pair) => {
    const [action, subject] = pair.split("::");
    if (ability.can(action, subject)) allowed.push(action);
  });

  return allowed;
}
