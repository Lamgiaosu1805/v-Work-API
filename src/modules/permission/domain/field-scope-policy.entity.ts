import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { ConditionTree, ConditionTreeProps } from "./value-objects/condition-tree.vo";
import { AttributeWhitelist } from "./data-scope-policy.entity";
import { SystemPolicyNotMutableError, InvalidAttributePathError } from "./permission.errors";
import { FieldScopePolicyChangedDomainEvent } from "./events/field-scope-policy-changed.domain-event";

export interface FieldScopePolicyProps {
  code: string;
  entity: string;
  label: string;
  isSystemPolicy: boolean;
  fields: string[];
  conditionTree: ConditionTreeProps | null;
}

// Field Scope Policy dùng chung AttributeWhitelist với Data Scope Policy (resource/subject path),
// thêm whitelist field name hợp lệ của entity (cũng lấy từ EntityAttributeCatalog).
export interface FieldAttributeWhitelist extends AttributeWhitelist {
  fields: string[];
}

export interface CreateFieldScopePolicyInput {
  id: string;
  code: string;
  entity: string;
  label: string;
  fields: string[];
  conditionTree?: ConditionTreeProps | null;
  isSystemPolicy?: boolean;
}

export class FieldScopePolicyEntity extends AggregateRoot<FieldScopePolicyProps> {
  static create(
    {
      id,
      code,
      entity,
      label,
      fields,
      conditionTree = null,
      isSystemPolicy = false
    }: CreateFieldScopePolicyInput,
    whitelist: FieldAttributeWhitelist
  ): FieldScopePolicyEntity {
    const policy = new FieldScopePolicyEntity({
      id,
      props: { code, entity, label, isSystemPolicy, fields, conditionTree }
    });
    policy._assertFieldsAndConditionAreWhitelisted(fields, conditionTree, whitelist);
    return policy;
  }

  get code(): string {
    return this.props.code;
  }

  get entityName(): string {
    return this.props.entity;
  }

  get label(): string {
    return this.props.label;
  }

  get isSystemPolicy(): boolean {
    return this.props.isSystemPolicy;
  }

  get fields(): string[] {
    return [...this.props.fields];
  }

  get conditionTree(): ConditionTree | null {
    return this.props.conditionTree ? ConditionTree.of(this.props.conditionTree) : null;
  }

  // rename() KHÔNG chặn System Policy — chỉ đổi label hiển thị, không đổi hành vi mask field thật
  // (khác với update/markDeleted).
  rename(label: string): void {
    this._setProps({ label });
  }

  // System Policy không được đổi fields/conditionTree — cùng lý do với DataScopePolicy.updateCondition
  // (xem comment ở đó): sửa âm thầm đổi hành vi mọi Role đang tham chiếu, rủi ro hơn cả xóa.
  update(
    fields: string[],
    conditionTree: ConditionTreeProps | null,
    whitelist: FieldAttributeWhitelist
  ): void {
    this.assertMutable();
    this._assertFieldsAndConditionAreWhitelisted(fields, conditionTree, whitelist);
    this._setProps({ fields, conditionTree });
    this.addEvent(
      new FieldScopePolicyChangedDomainEvent({ aggregateId: this.id, policyCode: this.props.code })
    );
  }

  assertMutable(): void {
    if (this.props.isSystemPolicy) {
      throw new SystemPolicyNotMutableError(undefined, {
        metadata: { policyId: this.id, policyCode: this.props.code }
      });
    }
  }

  markDeleted(): void {
    this.assertMutable();
    this.markAsDeleted();
    this.addEvent(
      new FieldScopePolicyChangedDomainEvent({ aggregateId: this.id, policyCode: this.props.code })
    );
  }

  private _assertFieldsAndConditionAreWhitelisted(
    fields: string[],
    conditionTree: ConditionTreeProps | null,
    whitelist: FieldAttributeWhitelist
  ): void {
    const invalidField = fields.find((field) => !whitelist.fields.includes(field));
    if (invalidField) {
      throw new InvalidAttributePathError(
        `Field "${invalidField}" không nằm trong danh sách field hợp lệ của entity "${this.props.entity}"`,
        { metadata: { policyCode: this.props.code, field: invalidField } }
      );
    }

    if (!conditionTree) return;

    const { resourcePaths, subjectPaths } =
      ConditionTree.of(conditionTree).collectReferencedPaths();

    const invalidResourcePath = resourcePaths.find(
      (path) => !whitelist.resourcePaths.includes(path)
    );
    if (invalidResourcePath) {
      throw new InvalidAttributePathError(
        `"${invalidResourcePath}" không nằm trong danh sách resource attribute hợp lệ của entity "${this.props.entity}"`,
        { metadata: { policyCode: this.props.code, path: invalidResourcePath } }
      );
    }

    const invalidSubjectPath = subjectPaths.find((path) => !whitelist.subjectPaths.includes(path));
    if (invalidSubjectPath) {
      throw new InvalidAttributePathError(
        `"${invalidSubjectPath}" không nằm trong danh sách subject attribute hợp lệ của entity "${this.props.entity}"`,
        { metadata: { policyCode: this.props.code, path: invalidSubjectPath } }
      );
    }
  }

  validate(): void {
    if (!this.props.code || typeof this.props.code !== "string") {
      throw new ArgumentInvalidException("FieldScopePolicy thiếu code hợp lệ");
    }
    if (!this.props.entity || typeof this.props.entity !== "string") {
      throw new ArgumentInvalidException("FieldScopePolicy thiếu entity hợp lệ");
    }
    if (!this.props.label || typeof this.props.label !== "string") {
      throw new ArgumentInvalidException("FieldScopePolicy thiếu label hợp lệ");
    }
    if (!Array.isArray(this.props.fields) || this.props.fields.length === 0) {
      throw new ArgumentInvalidException("FieldScopePolicy phải có ít nhất 1 field");
    }
    if (this.props.conditionTree) {
      ConditionTree.of(this.props.conditionTree);
    }
  }
}
