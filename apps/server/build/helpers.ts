import type { TArtifact } from '@mikotord/shared';
import {
  validateReleaseMetadata,
  type TReleaseMetadata
} from 'bun-sfe-autoupdater';
import fs from 'fs/promises';
import path from 'path';

const buildScriptDir = import.meta.dir;
const serverCwd = path.resolve(buildScriptDir, '..');
const rootCwd = path.resolve(serverCwd, '..', '..');

const rootPckJson = path.join(rootCwd, 'package.json');
const serverPckJson = path.join(rootCwd, 'apps', 'server', 'package.json');
const clientPckJson = path.join(rootCwd, 'apps', 'client', 'package.json');

const sharedPckJson = path.join(rootCwd, 'packages', 'shared', 'package.json');
const e2ePckJson = path.join(rootCwd, 'packages', 'e2e', 'package.json');
const pluginSdkPckJson = path.join(
  rootCwd,
  'packages',
  'plugin-sdk',
  'package.json'
);
const uiPckJson = path.join(rootCwd, 'packages', 'ui', 'package.json');
const scriptsPckJson = path.join(
  rootCwd,
  'packages',
  'scripts',
  'package.json'
);

const getCurrentVersion = async () => {
  const pkg = JSON.parse(await fs.readFile(rootPckJson, 'utf8'));

  return pkg.version;
};

const patchPackageJsons = async (newVersion: string) => {
  const packageJsonPaths = [
    rootPckJson,
    serverPckJson,
    clientPckJson,
    sharedPckJson,
    e2ePckJson,
    pluginSdkPckJson,
    scriptsPckJson,
    uiPckJson
  ];

  for (const pckPath of packageJsonPaths) {
    const pkg = JSON.parse(await fs.readFile(pckPath, 'utf8'));

    pkg.version = newVersion;

    await fs.writeFile(pckPath, JSON.stringify(pkg, null, 2), 'utf8');
  }
};

type TTarget = {
  out: string;
  target: Bun.Build.Target;
};

const compile = async ({ out, target }: TTarget) => {
  const version = await getCurrentVersion();

  const entryPoints = [
    path.join(serverCwd, 'src', 'index.ts'),
    path.join(serverCwd, 'build', 'temp', 'drizzle.zip'),
    path.join(serverCwd, 'build', 'temp', 'interface.zip')
  ];

  await Bun.build({
    entrypoints: entryPoints,
    compile: {
      outfile: out,
      target
    },
    define: {
      'process.env.MIKOTORD_ENV': '"production"',
      'process.env.MIKOTORD_BUILD_VERSION': `"${version}"`,
      'process.env.MIKOTORD_BUILD_DATE': `"${new Date().toISOString()}"`,
      'process.env.CURRENT_VERSION': `"${version}"`
    }
  });
};

const getFileChecksum = async (filePath: string) => {
  const fileBuffer = await fs.readFile(filePath);
  const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
};

const getVersionInfo = async (
  targets: TTarget[],
  outPath: string
): Promise<TReleaseMetadata> => {
  const version = await getCurrentVersion();

  const artifacts: TArtifact[] = [];

  for (const target of targets) {
    const artifactPath = path.join(outPath, target.out);

    artifacts.push({
      name: path.basename(artifactPath),
      target: target.target.replace('bun-', ''),
      size: (await fs.stat(artifactPath)).size,
      checksum: await getFileChecksum(artifactPath)
    });
  }

  const versionInfo = validateReleaseMetadata({
    version,
    releaseDate: new Date().toISOString(),
    artifacts
  });

  return versionInfo;
};

const rmIfExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    await fs.rm(filePath);
  } catch {
    // ignore
  }
};

export {
  compile,
  getCurrentVersion,
  getVersionInfo,
  patchPackageJsons,
  rmIfExists
};
export type { TTarget };
