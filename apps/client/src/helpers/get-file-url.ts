import type { TFile } from '@mikotord/shared';

const DEV_SERVER_PORT = '4991';

const getHostFromServer = () => {
  if (import.meta.env.MODE === 'development') {
    const host = window.location.hostname || 'localhost';

    return `${host}:${DEV_SERVER_PORT}`;
  }

  return window.location.host;
};

const getUrlFromServer = () => {
  const currentProtocol = window.location.protocol;
  const host =
    import.meta.env.MODE === 'development'
      ? getHostFromServer()
      : window.location.host;

  const finalUrl = `${currentProtocol}//${host}`;

  return finalUrl;
};

const getFileUrl = (file: TFile | undefined | null) => {
  if (!file) return '';

  const url = getUrlFromServer();
  const query = new URLSearchParams();

  const baseUrl = `${url}/public/${encodeURIComponent(file.name)}`;

  if (file._accessToken) {
    query.set('accessToken', file._accessToken);

    if (file._accessTokenExpiresAt) {
      query.set('expires', String(file._accessTokenExpiresAt));
    }
  }

  const queryString = query.toString();

  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

export { getFileUrl, getHostFromServer, getUrlFromServer };
