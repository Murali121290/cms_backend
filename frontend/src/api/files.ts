import { apiClient } from "@/api/client";
import type {
  FileCheckoutResponse,
  FileDeleteResponse,
  FileUploadResponse,
  FileVersionsResponse,
} from "@/types/api";

function getDownloadFilename(contentDisposition: string | undefined, fallbackFilename: string) {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1];
  }

  return fallbackFilename;
}

export async function downloadFile(fileId: number, fallbackFilename: string) {
  const response = await apiClient.get<Blob>(`/files/${fileId}/download`, {
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers["content-disposition"], fallbackFilename),
  };
}

export async function checkoutFile(fileId: number) {
  const response = await apiClient.post<FileCheckoutResponse>(`/files/${fileId}/checkout`);
  return response.data;
}

export async function cancelCheckout(fileId: number) {
  const response = await apiClient.delete<FileCheckoutResponse>(`/files/${fileId}/checkout`);
  return response.data;
}

export async function deleteFile(fileId: number) {
  const response = await apiClient.delete<FileDeleteResponse>(`/files/${fileId}`);
  return response.data;
}

export async function uploadChapterFiles({
  projectId,
  chapterId,
  category,
  files,
}: {
  projectId: number;
  chapterId: number;
  category: string;
  files: File[];
}) {
  const formData = new FormData();
  formData.append("category", category);
  files.forEach((file) => {
    formData.append("files", file);
  });

  const response = await apiClient.post<FileUploadResponse>(
    `/projects/${projectId}/chapters/${chapterId}/files/upload`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );
  return response.data;
}

export async function getFileVersions(fileId: number, limit = 50) {
  const response = await apiClient.get<FileVersionsResponse>(`/files/${fileId}/versions`, {
    params: { limit },
  });
  return response.data;
}

export async function downloadChapterPackage(projectId: number, chapterId: number, fallbackFilename: string) {
  const response = await apiClient.get<Blob>(
    `/projects/${projectId}/chapters/${chapterId}/package`,
    { responseType: "blob" },
  );

  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers["content-disposition"], fallbackFilename),
  };
}

export async function downloadFileVersion(fileId: number, versionId: number, fallbackFilename: string) {
  const response = await apiClient.get<Blob>(`/files/${fileId}/versions/${versionId}/download`, {
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers["content-disposition"], fallbackFilename),
  };
}
