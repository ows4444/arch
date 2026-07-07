export interface RMQPublishHeaders {
  requestId: string;
  correlationId?: string;
  causationId?: string;
}
