import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string,
    public readonly verificationRequired = false, public readonly retryAfterSeconds?: number) { super(message); }
}

let accessToken: string | null = null;
let csrfTokenValue: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  window.dispatchEvent(new Event('gloomi:auth-changed'));
}
export function getAccessToken() { return accessToken; }
export function setCsrfToken(token: string | null) { csrfTokenValue = token; }

export async function uploadMedia(file: File, intent: 'POST' | 'STORY' | 'AVATAR', onProgress?: (percent: number) => void, signal?: AbortSignal) {
  const { data: upload } = await api.post('/media/uploads', { contentType: file.type, sizeBytes: file.size, intent }, { signal });
  try {
  if (upload.provider === 'local') {
    await api.put(upload.uploadUrl, file, { headers: { 'Content-Type': file.type }, signal,
      onUploadProgress: event => { if (event.total) onProgress?.(Math.min(95, Math.round(event.loaded / event.total * 95))); } });
  } else if (upload.provider === 's3-put') {
    await axios.put(upload.uploadUrl as string, file, { headers: { 'Content-Type': file.type }, signal, withCredentials: false,
      onUploadProgress: event => { if (event.total) onProgress?.(Math.min(95, Math.round(event.loaded / event.total * 95))); } });
  } else {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields as Record<string, string>)) form.append(key, value);
  form.append('file', file);
    await axios.post(upload.uploadUrl as string, form, {
      signal,
      withCredentials: false,
      onUploadProgress: event => { if (event.total) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100))); },
    });
  }
  await api.post(`/media/uploads/${upload.mediaId}/finalize`, null, { signal });
  onProgress?.(100);
  return upload.mediaId as string;
  } catch (error) {
    void api.delete(`/media/${upload.mediaId}`).catch(() => {});
    throw new Error(signal?.aborted ? 'Загрузка отменена.' : error instanceof ApiError ? error.message : 'Не удалось загрузить файл. Проверьте формат и соединение, затем повторите попытку.');
  }
}

const loopbackHost = ['localhost','127.0.0.1'].includes(window.location.hostname) ? window.location.hostname : 'localhost';
const baseURL = import.meta.env.VITE_API_URL || `http://${loopbackHost}:3000/api`;
export const api = axios.create({ baseURL, withCredentials: true, withXSRFToken: true, xsrfCookieName: 'gloomi.csrf', xsrfHeaderName: 'X-CSRF-Token' });

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = axios.get(`${baseURL}/auth/csrf`, { withCredentials: true }).then(async ({ data }) => {
      setCsrfToken(data.csrfToken);
      if (!data.csrfToken) { setAccessToken(null); return null; }
      const response = await axios.post(`${baseURL}/auth/refresh`, null, { withCredentials: true, headers: { 'X-CSRF-Token': csrfTokenValue } });
      setCsrfToken(response.data.csrfToken);
      setAccessToken(response.data.accessToken);
      return response.data.accessToken as string;
    }).catch(() => {
      setAccessToken(null);
      setCsrfToken(null);
      return null;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function restoreSession() { return refreshAccessToken(); }

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (csrfTokenValue) config.headers['X-CSRF-Token'] = csrfTokenValue;
  return config;
});

api.interceptors.response.use(response => response, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  const url = String(original?.url || '');
  if (error.response?.status === 401 && original && !original._retried && !url.startsWith('/auth/')) {
    original._retried = true;
    const token = await refreshAccessToken();
    if (token) {
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    }
  }
  const data = error.response?.data as { message?: string | string[]; code?: string; verificationRequired?: boolean; retryAfterSeconds?: number } | undefined;
  return Promise.reject(new ApiError(
    (Array.isArray(data?.message) ? data.message.join('. ') : data?.message) || 'Не удалось выполнить запрос. Проверьте соединение с сервером.',
    error.response?.status, data?.code, data?.verificationRequired, data?.retryAfterSeconds));
});
