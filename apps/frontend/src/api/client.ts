// apps/frontend/src/api/client.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { CONTRACT } from "./contract";

// Normalize baseURL (remove trailing slashes)
const normalizeBase = (url: string) => (url || "").replace(/\/+$/, "");

// Single axios instance
export const api = axios.create({
  baseURL: normalizeBase(CONTRACT.baseURL),
  timeout: 20000,          // 20s
  withCredentials: false,  // flip to true if your API uses cookies
  headers: { Accept: "application/json" },
});

// Attach Authorization + sensible Content-Type defaults
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (CONTRACT.bearerAuth) {
    const jwt = localStorage.getItem("jwt");
    if (jwt) {
      config.headers = config.headers ?? {};
      (config.headers as any).Authorization = `Bearer ${jwt}`;
    }
  }

  // If sending JSON (not FormData), ensure Content-Type
  const method = (config.method || "get").toLowerCase();
  const isJsonWrite =
    method !== "get" &&
    method !== "delete" &&
    !(config.data instanceof FormData);

  if (isJsonWrite && !(config.headers as any)["Content-Type"]) {
    (config.headers as any)["Content-Type"] = "application/json";
  }

  return config;
});

// Decorate errors with useful bits (URL/method/status) for UI logs
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<any>) => {
    if (err.config) {
      (err as any).config = {
        url: err.config.url,
        method: err.config.method,
        baseURL: err.config.baseURL,
      };
    }
    return Promise.reject(err);
  }
);

/* ----------------------- Helpers ----------------------- */

/** Set or clear the JWT used by the client and stored in localStorage. */
export const setAuthToken = (token?: string) => {
  if (token) localStorage.setItem("jwt", token);
  else localStorage.removeItem("jwt");
};

/** Perform a POST with X-HTTP-Method-Override for servers that need it. */
export const methodOverride = <T = any>(
  method: "PUT" | "PATCH" | "DELETE",
  url: string,
  data?: any
) => api.post<T>(url, data, { headers: { "X-HTTP-Method-Override": method } });

/** Uniform error shape you can use in UI if desired. */
export type ApiError = { status?: number; message: string; details?: any };
export const toApiError = (e: any): ApiError => ({
  status: e?.response?.status,
  message: e?.response?.data?.message || e?.message || "Request failed",
  details: e?.response?.data,
});

export default api;
