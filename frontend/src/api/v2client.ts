import axios from 'axios';

// cms_backend API client (base /api/v2, cookie auth)
export const v2Client = axios.create({
  baseURL: '/api/v2',
  withCredentials: true, // enables cookie auth
});

export const getApiErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data as any;
    if (typeof data === 'object' && data !== null) {
      if ('message' in data) return data.message;
      if ('detail' in data) return data.detail;
      if ('error' in data) return data.error;
    }
  }
  return error instanceof Error ? error.message : 'An error occurred';
};
