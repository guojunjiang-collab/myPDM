import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const syncClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

syncClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const syncApi = {
  /** Get sync status - returns max timestamps per table */
  getStatus: () => syncClient.get('/sync/status'),
};
