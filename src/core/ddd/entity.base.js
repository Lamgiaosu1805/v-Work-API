const {
  ArgumentNotProvidedException,
  ArgumentInvalidException
} = require("../exceptions/exceptions");

class Entity {
  constructor({ id, props, createdAt, updatedAt, isDeleted }, { validate = true } = {}) {
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

  _setProps(newProps) {
    this.props = { ...this.props, ...newProps };
    this._updatedAt = new Date();
    this.validate();
  }

  get id() {
    return this._id;
  }

  get createdAt() {
    return this._createdAt;
  }

  get updatedAt() {
    return this._updatedAt;
  }

  get isDeleted() {
    return this._isDeleted;
  }

  static isEntity(candidate) {
    return candidate instanceof Entity;
  }

  equals(other) {
    if (other == null) return false;
    if (this === other) return true;
    if (!Entity.isEntity(other)) return false;
    return this._id === other.id;
  }

  getProps() {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      isDeleted: this._isDeleted,
      ...this.props
    });
  }

  markAsDeleted() {
    this._isDeleted = true;
    this._updatedAt = new Date();
  }

  // eslint-disable-next-line class-methods-use-this
  validate() {
    throw new Error("Entity.validate() must be implemented by a subclass.");
  }
}

module.exports = { Entity };
