const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

const markdownExtensions = new Set(['.md', '.markdown', '.mdown', '.mdx']);

const syntaxLanguageByExtension: Record<string, string> = {
  '.bash': 'bash',
  '.c': 'c',
  '.conf': 'nginx',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.csv': 'csv',
  '.env': 'bash',
  '.go': 'go',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'markup',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.less': 'less',
  '.log': 'text',
  '.lua': 'lua',
  '.mjs': 'javascript',
  '.php': 'php',
  '.properties': 'properties',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sass': 'sass',
  '.scss': 'scss',
  '.sh': 'bash',
  '.sql': 'sql',
  '.svelte': 'markup',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.vue': 'markup',
  '.xml': 'markup',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'bash'
};

const syntaxLanguageByName: Record<string, string> = {
  '.dockerignore': 'gitignore',
  '.editorconfig': 'editorconfig',
  '.env': 'bash',
  '.gitignore': 'gitignore',
  dockerfile: 'docker',
  makefile: 'makefile',
  'nginx.conf': 'nginx',
  procfile: 'text',
  readme: 'markdown',
  license: 'text'
};

const plainTextExtensions = new Set([
  '.cfg',
  '.cnf',
  '.config',
  '.diff',
  '.lock',
  '.patch',
  '.text'
]);

const textMimeTypes = new Set([
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-sh',
  'application/xhtml+xml',
  'application/xml',
  'application/yaml',
  'application/yml',
  'image/svg+xml'
]);

type TPreviewableFileInfo = {
  name: string;
  extension: string;
  mimeType?: string;
};

const getNormalizedFileName = (name: string) => name.trim().toLowerCase();

const getNormalizedExtension = (extension: string) =>
  extension
    ? extension.startsWith('.')
      ? extension.toLowerCase()
      : `.${extension}`.toLowerCase()
    : '';

const getTextFileLanguage = ({ name, extension }: TPreviewableFileInfo) => {
  const normalizedName = getNormalizedFileName(name);
  const normalizedExtension = getNormalizedExtension(extension);

  if (markdownExtensions.has(normalizedExtension)) {
    return 'markdown';
  }

  return (
    syntaxLanguageByName[normalizedName] ??
    syntaxLanguageByExtension[normalizedExtension] ??
    'text'
  );
};

const isTextPreviewableFile = ({
  name,
  extension,
  mimeType
}: TPreviewableFileInfo) => {
  const normalizedName = getNormalizedFileName(name);
  const normalizedExtension = getNormalizedExtension(extension);
  const normalizedMimeType = mimeType?.split(';')[0]?.trim().toLowerCase();

  return (
    markdownExtensions.has(normalizedExtension) ||
    !!syntaxLanguageByExtension[normalizedExtension] ||
    !!syntaxLanguageByName[normalizedName] ||
    plainTextExtensions.has(normalizedExtension) ||
    !!normalizedMimeType?.startsWith('text/') ||
    (normalizedMimeType ? textMimeTypes.has(normalizedMimeType) : false)
  );
};

export { MAX_TEXT_PREVIEW_BYTES, getTextFileLanguage, isTextPreviewableFile };
