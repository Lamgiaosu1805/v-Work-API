import { randomUUID } from "crypto";
import { ArgumentNotProvidedException } from "../exceptions/exceptions";
import { RequestContextService } from "../context/request-context";
import { Metadata } from "./types";

export interface DomainEventProps {
  aggregateId: string;
  metadata?: Partial<Metadata>;
  [key: string]: unknown;
}

export abstract class DomainEvent {
  readonly id: string;

  readonly aggregateId: string;

  readonly metadata: Metadata;

  constructor(props: DomainEventProps) {
    if (!props || typeof props !== "object" || !props.aggregateId) {
      throw new ArgumentNotProvidedException("DomainEvent requires props.aggregateId.");
    }

    this.id = randomUUID();
    this.aggregateId = props.aggregateId;
    this.metadata = {
      correlationId: props.metadata?.correlationId || RequestContextService.getRequestId(),
      causationId: props.metadata?.causationId,
      timestamp: props.metadata?.timestamp || Date.now(),
      userId: props.metadata?.userId
    };
  }
}
