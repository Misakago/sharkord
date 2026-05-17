import 'ws';

declare module 'ws' {
  interface WebSocket {
    userId?: number;
    token: string;
  }
}

type TCommandMap = {
  [pluginId: string]: {
    [commandName: string]: TCommand;
  };
};

type TCommand = (...args: unknown[]) => Promise<unknown> | unknown;

declare global {
  interface Window {
    __plugins?: {
      commands: TCommandMap;
    };
  }
  // eslint-disable-next-line no-var
  var disableRateLimiting: boolean | undefined;
}

declare module 'bun' {
  interface Env {
    // MIKOTORD_ prefixed environment variables
    MIKOTORD_PORT?: string;
    MIKOTORD_DEBUG?: string;
    MIKOTORD_AUTOUPDATE?: string;
    MIKOTORD_DATA_PATH?: string;
  }
}

declare module 'node:fs/promises' {
  export function exists(path: import('node:fs').PathLike): Promise<boolean>;
}

declare module 'fs/promises' {
  export function exists(path: import('node:fs').PathLike): Promise<boolean>;
}
