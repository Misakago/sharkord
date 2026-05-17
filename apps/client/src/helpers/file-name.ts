const normalizeFileExtension = (extension: string) => {
  if (!extension) return '';

  return extension.startsWith('.') ? extension : `.${extension}`;
};

const sanitizeFileNameInput = (value: string) =>
  value
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\0\r\n]/g, '')
    .trim() ?? '';

const splitFileNameForLockedExtension = (name: string, extension: string) => {
  const normalizedExtension = normalizeFileExtension(extension);
  const safeName = sanitizeFileNameInput(name) || name.trim();

  if (
    normalizedExtension &&
    safeName.toLowerCase().endsWith(normalizedExtension.toLowerCase())
  ) {
    return {
      baseName: safeName.slice(0, -normalizedExtension.length),
      extension: normalizedExtension
    };
  }

  return {
    baseName: safeName,
    extension: normalizedExtension
  };
};

const getFileNameWithLockedExtension = (
  currentName: string,
  extension: string,
  nextBaseName: string
) => {
  const normalizedExtension = normalizeFileExtension(extension);
  const safeBaseName = sanitizeFileNameInput(nextBaseName);

  if (!safeBaseName) {
    return currentName;
  }

  const baseName =
    normalizedExtension &&
    safeBaseName.toLowerCase().endsWith(normalizedExtension.toLowerCase())
      ? safeBaseName.slice(0, -normalizedExtension.length).trim()
      : safeBaseName;

  if (!baseName) {
    return currentName;
  }

  return `${baseName}${normalizedExtension}`;
};

export {
  getFileNameWithLockedExtension,
  normalizeFileExtension,
  splitFileNameForLockedExtension
};
