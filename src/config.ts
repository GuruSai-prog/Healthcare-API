const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const API_BASE_URL =
  process.env.API_BASE_URL ?? 'https://assessment.ksensetech.com/api';
export const API_KEY = process.env.API_KEY ?? '';

// Fewer pages means fewer calls and less chance of hitting rate limits.
// Default to the API's max page size (20) unless overridden via env.
export const DEFAULT_PAGE_LIMIT =
  parseNumber(process.env.PAGE_LIMIT, 20) || 20;
export const MAX_RETRIES =
  parseNumber(process.env.MAX_RETRIES, 5) || 5;
export const RETRY_BASE_DELAY_MS =
  parseNumber(process.env.RETRY_BASE_DELAY_MS, 500) || 500;
export const RETRY_MAX_DELAY_MS =
  parseNumber(process.env.RETRY_MAX_DELAY_MS, 10000) || 10000;
export const RATE_LIMIT_DELAY_MS =
  parseNumber(process.env.RATE_LIMIT_DELAY_MS, 2000) || 2000;
export const PAGE_REQUEST_DELAY_MS =
  parseNumber(process.env.PAGE_REQUEST_DELAY_MS, 1000) || 1000;

export const USER_AGENT = 'healthcare-api-client/1.0.0';

if (!API_KEY) {
  console.warn(
    'Warning: API_KEY is empty. Provide x-api-key via the API_KEY environment variable.'
  );
}
