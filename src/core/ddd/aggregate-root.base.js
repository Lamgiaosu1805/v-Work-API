const { Entity } = require("./entity.base");

class AggregateRoot extends Entity {
  constructor(entityProps, options) {
    super(entityProps, options);
    if (new.target === AggregateRoot) {
      throw new Error("AggregateRoot is abstract and cannot be instantiated directly.");
    }
    this._domainEvents = [];
  }

  get domainEvents() {
    return [...this._domainEvents];
  }

  addEvent(domainEvent) {
    this._domainEvents.push(domainEvent);
  }

  clearEvents() {
    this._domainEvents = [];
  }

  async publishEvents(eventBus) {
    const events = this._domainEvents;
    this.clearEvents();

    const results = await Promise.allSettled(
      events.map((event) => eventBus.emitAsync(event.constructor.name, event))
    );

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        `${failures.length}/${events.length} domain event(s) failed to publish for ${this.constructor.name} ${this.id}`
      );
    }
  }
}

module.exports = { AggregateRoot };
