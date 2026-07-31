import { ArgumentNotProvidedException, ArgumentInvalidException } from "../exceptions/exceptions";

export interface EntityConstructorProps<Props> {
  id: string;
  props: Props;
  createdAt?: Date;
  updatedAt?: Date;
  isDeleted?: boolean;
}

export interface EntityOptions {
  validate?: boolean;
}

export abstract class Entity<Props extends object> {
  private readonly _id: string;

  protected props: Props;

  private _createdAt: Date;

  private _updatedAt: Date;

  private _isDeleted: boolean;

  constructor(
    { id, props, createdAt, updatedAt, isDeleted }: EntityConstructorProps<Props>,
    { validate = true }: EntityOptions = {}
  ) {
    if (new.target === Entity) {
      throw new Error("Entity is abstract and cannot be instantiated directly.");
    }
    if (id === null || id === undefined) {
      throw new ArgumentNotProvidedException("Entity must be created with an id.");
    }
    if (!props || typeof props !== "object") {
      throw new ArgumentInvalidException("Entity props should be an object.");
    }

    this._id = id;

    this.props = { ...props };

    const now = new Date();
    this._createdAt = createdAt || now;
    this._updatedAt = updatedAt || now;
    this._isDeleted = isDeleted ?? false;

    if (validate) {
      this.validate();
    }
  }

  protected _setProps(newProps: Partial<Props>): void {
    this.props = { ...this.props, ...newProps };
    this._updatedAt = new Date();
    this.validate();
  }

  get id(): string {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get isDeleted(): boolean {
    return this._isDeleted;
  }

  static isEntity(candidate: unknown): candidate is Entity<object> {
    return candidate instanceof Entity;
  }

  equals(other?: unknown): boolean {
    if (other === null || other === undefined) return false;
    if (this === other) return true;
    if (!Entity.isEntity(other)) return false;
    return this._id === other.id;
  }

  getProps(): Readonly<
    { id: string; createdAt: Date; updatedAt: Date; isDeleted: boolean } & Props
  > {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      isDeleted: this._isDeleted,
      ...this.props
    }) as Readonly<{ id: string; createdAt: Date; updatedAt: Date; isDeleted: boolean } & Props>;
  }

  markAsDeleted(): void {
    this._isDeleted = true;
    this._updatedAt = new Date();
  }

  // eslint-disable-next-line class-methods-use-this
  validate(): void {
    throw new Error("Entity.validate() must be implemented by a subclass.");
  }
}
