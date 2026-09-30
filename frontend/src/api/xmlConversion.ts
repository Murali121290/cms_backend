import api from './client';

export const xmlConversionApi = {
  getProjects: async () => {
    const response = await api.get('/post-prod/xml-conversion/projects');
    return response.data;
  },

  createProject: async (clientCode: string, projectName: string, targetFormat: string, file: File) => {
    const formData = new FormData();
    formData.append('client_code', clientCode);
    formData.append('project_name', projectName);
    formData.append('target_format', targetFormat);
    formData.append('file', file);

    const response = await api.post('/post-prod/xml-conversion/projects', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  triggerConversion: async (projectId: number) => {
    const response = await api.post(`/post-prod/xml-conversion/projects/${projectId}/convert`);
    return response.data;
  },

  getValidationReport: async (projectId: number) => {
    const response = await api.get(`/post-prod/xml-conversion/projects/${projectId}/validation-report`);
    return response.data;
  },

  downloadConvertedXml: async (projectId: number) => {
    const response = await api.get(`/post-prod/xml-conversion/projects/${projectId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  }
};
