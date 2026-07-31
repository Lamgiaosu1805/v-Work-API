import { Entity, EntityConstructorProps, EntityOptions } from "./entity.base";
import { DomainEvent } from "./domain-event.base";
import { EventBus } from "./types";

export abstract class AggregateRoot<Props extends object> extends Entity<Props> {
  private _domainEvents: DomainEvent[];

  constructor(entityProps: EntityConstructorProps<Props>, options?: EntityOptions) {
    super(entityProps, options);
    if (new.target === AggregateRoot) {
      throw new Error("AggregateRoot is abstract and cannot be instantiated directly.");
    }
    this._domainEvents = [];
  }

  get domainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  addEvent(domainEvent: DomainEvent): void {
    this._domainEvents.push(domainEvent);
  }

  clearEvents(): void {
    this._domainEvents = [];
  }

  async publishEvents(eventBus: EventBus): Promise<void> {
    const events = this._domainEvents;
    this.clearEvents();

    const results = await Promise.allSettled(
      events.map((event) => eventBus.emitAsync(event.constructor.name, event))
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        `${failures.length}/${events.length} domain event(s) failed to publish for ${this.constructor.name} ${this.id}`
      );
    }
  }
}
