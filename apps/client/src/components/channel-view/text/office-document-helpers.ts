const OFFICE_FILE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx'
]);

const getNormalizedOfficeExtension = (extension: string) =>
  extension
    ? extension.startsWith('.')
      ? extension.toLowerCase()
      : `.${extension}`.toLowerCase()
    : '';

const isOfficePreviewableFile = ({ extension }: { extension: string }) =>
  OFFICE_FILE_EXTENSIONS.has(getNormalizedOfficeExtension(extension));

export { isOfficePreviewableFile };
