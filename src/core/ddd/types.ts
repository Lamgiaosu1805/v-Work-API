export interface Metadata {
  correlationId?: string;
  causationId?: string;
  timestamp: number;
  userId?: string;
}

export interface EventBus {
  emitAsync(eventName: string, event: object): Promise<unknown>;
}
