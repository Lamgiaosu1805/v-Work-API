import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { ConditionTree, ConditionTreeProps } from "./value-objects/condition-tree.vo";
import { SystemPolicyNotMutableError, InvalidAttributePathError } from "./permission.errors";
import { DataScopePolicyChangedDomainEvent } from "./events/data-scope-policy-changed.domain-event";

export interface DataScopePolicyProps {
  code: string;
  entity: string;
  label: string;
  isSystemPolicy: boolean;
  conditionTree: ConditionTreeProps | null;
}
export interface AttributeWhitelist {
  resourcePaths: string[];
  subjectPaths: string[];
}

export interface CreateDataScopePolicyInput {
  id: string;
  code: string;
  entity: string;
  label: string;
  conditionTree: ConditionTreeProps | null;
  isSystemPolicy?: boolean;
}

export class DataScopePolicyEntity extends AggregateRoot<DataScopePolicyProps> {
  static create(
    { id, code, entity, label, conditionTree, isSystemPolicy = false }: CreateDataScopePolicyInput,
    whitelist: AttributeWhitelist
  ): DataScopePolicyEntity {
    const policy = new DataScopePolicyEntity({
      id,
      props: { code, entity, label, isSystemPolicy, conditionTree }
    });
    if (conditionTree) {
      policy._assertConditionUsesWhitelistedAttributes(conditionTree, whitelist);
    }
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

  get conditionTree(): ConditionTree | null {
    return this.props.conditionTree ? ConditionTree.of(this.props.conditionTree) : null;
  }

  rename(label: string): void {
    this._setProps({ label });
  }

  updateCondition(conditionTree: ConditionTreeProps | null, whitelist: AttributeWhitelist): void {
    this.assertMutable();
    if (conditionTree) {
      this._assertConditionUsesWhitelistedAttributes(conditionTree, whitelist);
    }
    this._setProps({ conditionTree });
    this.addEvent(
      new DataScopePolicyChangedDomainEvent({ aggregateId: this.id, policyCode: this.props.code })
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
      new DataScopePolicyChangedDomainEvent({ aggregateId: this.id, policyCode: this.props.code })
    );
  }

  private _assertConditionUsesWhitelistedAttributes(
    conditionTree: ConditionTreeProps,
    whitelist: AttributeWhitelist
  ): void {
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
      throw new ArgumentInvalidException("DataScopePolicy thiếu code hợp lệ");
    }
    if (!this.props.entity || typeof this.props.entity !== "string") {
      throw new ArgumentInvalidException("DataScopePolicy thiếu entity hợp lệ");
    }
    if (!this.props.label || typeof this.props.label !== "string") {
      throw new ArgumentInvalidException("DataScopePolicy thiếu label hợp lệ");
    }
    if (this.props.conditionTree) {
      ConditionTree.of(this.props.conditionTree);
    }
  }
}
