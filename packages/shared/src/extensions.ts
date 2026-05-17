export const imageExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.tiff',
  '.tif'
];

export const documentExtensions = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.rtf',
  '.odt',
  '.ods',
  '.odp'
];

export enum FileCategory {
  IMAGE = 'image',
  DOCUMENT = 'document',
  OTHER = 'other'
}

export const getFileCategory = (extension: string): FileCategory => {
  const ext = extension.toLowerCase();

  if (imageExtensions.includes(ext)) return FileCategory.IMAGE;
  if (documentExtensions.includes(ext)) return FileCategory.DOCUMENT;

  return FileCategory.OTHER;
};

export const isPreviewable = (file: File) => {
  const parts = file.name.split('.');
  const ext = parts.length > 1 ? `.${parts.pop()}` : '';
  const category = getFileCategory(ext);

  return category === FileCategory.IMAGE;
};
