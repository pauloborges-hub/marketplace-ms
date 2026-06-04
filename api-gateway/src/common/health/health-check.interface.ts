export enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded',
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: HealthStatus;
  responseTime: number;
  lastCheck: Date;
  error?: Error;
}
