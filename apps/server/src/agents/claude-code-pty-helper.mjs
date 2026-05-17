import { existsSync } from 'node:fs';
import os from 'node:os';
import * as pty from 'node-pty';

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const fail = (error) => {
  send({
    type: 'output',
    data: `[ClaudeCode helper error] ${error?.message ?? String(error)}\r\n`
  });
  send({ type: 'exit', exitCode: 1 });
  process.exit(1);
};

const payload = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8'));
const { NO_COLOR: _noColor, ...baseEnv } = payload.env ?? process.env;
const terminalEnv = {
  ...baseEnv,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  FORCE_COLOR: '3',
  CLICOLOR: '1',
  CLICOLOR_FORCE: '1',
  TERM_PROGRAM: 'xterm.js'
};
const defaultShell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh';
const configuredShell = terminalEnv.SHELL;
const shell =
  configuredShell && pathLooksExecutable(configuredShell)
    ? configuredShell
    : defaultShell;
const shellArgs = os.platform() === 'win32' ? [] : ['-l'];
let terminal;

terminalEnv.SHELL = shell;

try {
  terminal = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: payload.cols ?? 100,
    rows: payload.rows ?? 30,
    cwd: payload.cwd,
    env: terminalEnv
  });
} catch (error) {
  fail(
    new Error(
      `${error?.message ?? String(error)} (shell=${shell}, cwd=${payload.cwd})`
    )
  );
}

let inputBuffer = '';

terminal.onData((data) => {
  send({ type: 'output', data });
});

terminal.onExit(({ exitCode, signal }) => {
  send({ type: 'exit', exitCode, signal });
  process.exit(exitCode ?? 0);
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  const lines = inputBuffer.split('\n');
  inputBuffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;

    let message;

    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.type === 'input' && typeof message.data === 'string') {
      terminal.write(message.data);
    } else if (message.type === 'resize') {
      const cols = Number(message.cols);
      const rows = Number(message.rows);

      if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
        terminal.resize(cols, rows);
      }
    } else if (message.type === 'kill') {
      terminal.kill();
    }
  }
});

process.on('SIGTERM', () => terminal.kill());
process.on('SIGINT', () => terminal.kill());
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const commandLine = [payload.command, ...(payload.args ?? [])]
  .map(shellQuote)
  .join(' ');

terminal.write(`${commandLine}\r`);

function pathLooksExecutable(value) {
  if (os.platform() === 'win32') {
    return Boolean(value);
  }

  return value.startsWith('/') && existsSync(value);
}
