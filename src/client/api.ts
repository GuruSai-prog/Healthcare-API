import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  API_BASE_URL,
  API_KEY,
  DEFAULT_PAGE_LIMIT,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RATE_LIMIT_DELAY_MS,
  PAGE_REQUEST_DELAY_MS,
  USER_AGENT,
} from '../config';
import { AlertsPayload, PatientRecord, PatientsResponse } from '../types';

const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'User-Agent': USER_AGENT,
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const describeError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const code = error.response?.status ?? 'unknown';
    return `${error.message} (${code})`;
  }
  return String(error);
};

const isRetryableError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) {
    return true;
  }

  const status = error.response?.status;
  if (!status) {
    return true;
  }

  return status === 429 || (status >= 500 && status < 600);
};

const withRetry = async <T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> => {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;

      if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }

      // Check if it's a 429 rate limit error
      const isRateLimit = axios.isAxiosError(error) && error.response?.status === 429;
      
      let delay: number;
      
      if (isRateLimit) {
        // For 429 errors, check for Retry-After in header first, then in response body
        const headers = error.response?.headers;
        let retryAfter: string | number | undefined = 
          headers?.['retry-after'] || headers?.['Retry-After'];
        
        // If not in header, check response body (some APIs return retry_after in JSON)
        if (!retryAfter && error.response?.data) {
          const body = error.response.data;
          if (body && typeof body === 'object') {
            retryAfter = (body as any).retry_after || 
                        (body as any).retryAfter || 
                        (body as any).retry_after_seconds ||
                        (body as any).retryAfterSeconds;
          }
        }
        
        if (retryAfter) {
          const retryAfterValue = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          const retryAfterSeconds = Number.parseInt(String(retryAfterValue), 10);
          // Validate: must be positive and reasonable (max 1 hour)
          if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 3600) {
            delay = retryAfterSeconds * 1000; // Convert to milliseconds
            const source = headers?.['retry-after'] || headers?.['Retry-After'] ? 'header' : 'body';
            console.warn(
              `[rate-limit] ${label} hit rate limit. Retry-After (${source}): ${retryAfterSeconds}s`
            );
          } else {
            // Use longer delay for 429 errors if retry_after value is invalid
            delay = Math.min(
              RETRY_MAX_DELAY_MS,
              RATE_LIMIT_DELAY_MS * (attempt)
            );
          }
        } else {
          // Use longer delay for 429 errors without Retry-After in header or body
          delay = Math.min(
            RETRY_MAX_DELAY_MS,
            RATE_LIMIT_DELAY_MS * (attempt)
          );
        }
      } else {
        // Exponential backoff for other retryable errors (5xx)
        const backoff = Math.min(
          RETRY_MAX_DELAY_MS,
          RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
        );
        const jitter = Math.random() * 200;
        delay = Math.min(RETRY_MAX_DELAY_MS, backoff + jitter);
      }

      console.warn(
        `[retry] ${label} failed (attempt ${attempt}): ${describeError(
          error
        )}. Retrying in ${Math.round(delay)}ms`
      );

      await sleep(delay);
    }
  }
};

export const fetchAllPatients = async (
  limit: number = DEFAULT_PAGE_LIMIT
): Promise<PatientRecord[]> => {
  const patients: PatientRecord[] = [];
  let page = 1;
  let hasNext = true;
  let safety = 100; // guard against infinite loops

  console.log(`[api] Starting to fetch patients (limit: ${limit} per page)`);

  while (hasNext) {
    if (safety-- <= 0) {
      console.warn('[api] pagination safety break triggered');
      break;
    }

    console.log(`[api] Fetching page ${page}...`);
    const response = await withRetry<AxiosResponse<PatientsResponse>>(
      () => http.get('/patients', { params: { page, limit } }),
      `GET /patients?page=${page}&limit=${limit}`
    );

    // Handle different response formats - API may return inconsistent formats
    let pageData: PatientRecord[] = [];
    
    if (Array.isArray(response.data.data)) {
      pageData = response.data.data;
    } else if (Array.isArray(response.data)) {
      // Sometimes data might be directly in response.data
      pageData = response.data;
    } else if (response.data && typeof response.data === 'object') {
      // Try to extract patients from various possible structures
      const possibleData = (response.data as any).patients || (response.data as any).results || [];
      if (Array.isArray(possibleData)) {
        pageData = possibleData;
      }
    }
    
    if (pageData.length === 0 && Array.isArray(response.data.data)) {
      // Empty array is valid
      pageData = [];
    } else if (pageData.length === 0) {
      console.warn(
        `[warn] GET /patients?page=${page} returned unexpected data format. Response structure:`,
        Object.keys(response.data || {}).join(', ')
      );
    }

    patients.push(...pageData);
    console.log(`[api] Page ${page}: fetched ${pageData.length} patients (total: ${patients.length})`);
    
    // Determine whether to continue. Prefer explicit pagination metadata;
    // fall back to totalPages or data length if hasNext is missing/incorrect.
    const pagination = response.data.pagination;
    const reportedPage = pagination?.page;
    
    // Validate currentPage - if it's way off from our page, use ours instead
    // Allow small differences (1-2) in case of API inconsistencies
    const currentPage = (reportedPage !== undefined && 
                        Math.abs(reportedPage - page) <= 2) 
                        ? reportedPage 
                        : page;
    
    const totalPages = pagination?.totalPages;
    const hasNextFlag = pagination?.hasNext;

    const hasMoreByPagination =
      hasNextFlag === true ||
      (totalPages !== undefined && currentPage < totalPages);

    const hasMoreByCount = pageData.length >= limit;

    hasNext = hasMoreByPagination || hasMoreByCount;
    
    // Increment page carefully - use max of currentPage+1 and page+1 to avoid going backwards
    page = Math.max(currentPage + 1, page + 1);

    // Add delay between page requests to avoid rate limiting
    // Only delay if there are more pages to fetch
    if (hasNext) {
      console.log(`[api] Waiting ${PAGE_REQUEST_DELAY_MS}ms before next page to avoid rate limits...`);
      await sleep(PAGE_REQUEST_DELAY_MS);
    }
  }

  console.log(`[api] Finished fetching all patients. Total: ${patients.length}`);
  return patients;
};

export const submitAssessment = async (
  payload: AlertsPayload
): Promise<Record<string, unknown>> => {
  console.log('[api] Submitting assessment results...');
  const response = await withRetry<AxiosResponse<Record<string, unknown>>>(
    () => http.post('/submit-assessment', payload),
    'POST /submit-assessment'
  );
  console.log('[api] Assessment submission successful');
  return response.data;
};
