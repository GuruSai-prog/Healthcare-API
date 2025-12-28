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

      const isRateLimit = axios.isAxiosError(error) && error.response?.status === 429;
      
      let delay: number;
      
      if (isRateLimit) {
        const headers = error.response?.headers;
        let retryAfter: string | number | undefined = 
          headers?.['retry-after'] || headers?.['Retry-After'];
        
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
          if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 3600) {
            delay = retryAfterSeconds * 1000;
          } else {
            delay = Math.min(
              RETRY_MAX_DELAY_MS,
              RATE_LIMIT_DELAY_MS * (attempt)
            );
          }
        } else {
          delay = Math.min(
            RETRY_MAX_DELAY_MS,
            RATE_LIMIT_DELAY_MS * (attempt)
          );
        }
      } else {
        const backoff = Math.min(
          RETRY_MAX_DELAY_MS,
          RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
        );
        const jitter = Math.random() * 200;
        delay = Math.min(RETRY_MAX_DELAY_MS, backoff + jitter);
      }

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
  let safety = 100;

  while (hasNext) {
    if (safety-- <= 0) {
      break;
    }
    const response = await withRetry<AxiosResponse<PatientsResponse>>(
      () => http.get('/patients', { params: { page, limit } }),
      `GET /patients?page=${page}&limit=${limit}`
    );

    let pageData: PatientRecord[] = [];
    
    if (Array.isArray(response.data.data)) {
      pageData = response.data.data;
    } else if (Array.isArray(response.data)) {
      pageData = response.data;
    } else if (response.data && typeof response.data === 'object') {
      const possibleData = (response.data as any).patients || (response.data as any).results || [];
      if (Array.isArray(possibleData)) {
        pageData = possibleData;
      }
    }
    
    if (pageData.length === 0 && Array.isArray(response.data.data)) {
      pageData = [];
    }

    patients.push(...pageData);
    
    const pagination = response.data.pagination;
    const reportedPage = pagination?.page;
    
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
    
    page = Math.max(currentPage + 1, page + 1);

    if (hasNext) {
      await sleep(PAGE_REQUEST_DELAY_MS);
    }
  }
  return patients;
};

export const submitAssessment = async (
  payload: AlertsPayload
): Promise<Record<string, unknown>> => {
  const response = await withRetry<AxiosResponse<Record<string, unknown>>>(
    () => http.post('/submit-assessment', payload),
    'POST /submit-assessment'
  );
  return response.data;
};
