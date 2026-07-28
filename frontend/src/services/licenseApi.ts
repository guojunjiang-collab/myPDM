import api from './api';
import type { LicenseStatus } from '../types';

export const licenseApi = {
  async getStatus(): Promise<LicenseStatus> {
    return (await api.get('/license/status')).data;
  },

  async getMachineCode(): Promise<string> {
    return (await api.get('/license/machine-code')).data.machine_code;
  },

  async upload(file: File): Promise<LicenseStatus> {
    const form = new FormData();
    form.append('file', file);
    return (await api.post('/license/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data;
  },
};
