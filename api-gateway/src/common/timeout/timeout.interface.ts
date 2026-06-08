export interface TimeoutOptions {
  timeout: number;
  retries: number;
  backoffMultiplier: number;
  maxBackoff: number;
}
