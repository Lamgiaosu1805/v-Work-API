import { randomUUID } from "crypto";
import { ArgumentNotProvidedException } from "../exceptions/exceptions";
import { RequestContextService } from "../context/request-context";
import { Metadata } from "./types";

export interface CommandProps {
  id?: string;
  metadata?: Partial<Metadata>;
  [key: string]: unknown;
}

export class Command {
  readonly id: string;

  readonly metadata: Metadata;

  constructor(props: CommandProps) {
    if (!props || typeof props !== "object") {
      throw new ArgumentNotProvidedException("Command props should not be empty.");
    }

    this.id = props.id || randomUUID();
    this.metadata = {
      correlationId: props.metadata?.correlationId || RequestContextService.getRequestId(),
      causationId: props.metadata?.causationId,
      timestamp: props.metadata?.timestamp || Date.now(),
      userId: props.metadata?.userId
    };
  }
}
