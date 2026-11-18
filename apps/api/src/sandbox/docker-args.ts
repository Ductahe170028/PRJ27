import { readIntEnv, readNumberEnv } from '../config/env.js';

/** Pinned together with deploy/sandbox/Dockerfile (a test keeps them equal). */
export const SANDBOX_PLAYWRIGHT_VERSION = '1.60.0';
export const DEFAULT_SANDBOX_IMAGE = `gamecreator-sandbox:pw${SANDBOX_PLAYWRIGHT_VERSION}`;
export const SANDBOX_LABEL = 'gamecreator.sandbox=1';
/** Unprivileged numeric user. It need not exist in the image's /etc/passwd. */
export const SANDBOX_USER = '10001:10001';
export const SANDBOX_ENTRY_DIR = '/opt/gc/apps/api/dist/sandbox';

export interface SandboxConfig {
  dockerBin: string;
  image: string;
  /** Containers allowed at once. One Chromium fits a 2 GB host; more does not. */
  concurrency: number;
  memoryMb: number;
  cpus: number;
  pids: number;
  tmpMb: number;
  shmMb: number;
  /** Wall-clock limit for one container. */
  timeoutMs: number;
  /** How often the isolation self-check is repeated. */
  recheckMs: number;
}

/** Defaults sized for a t3.small (2 vCPU, 2 GB): one Chromium at a time, capped
 * at 768 MB and 1 CPU, leaving the rest for the OS, Docker, Nginx and Node. */
export function readSandboxConfig(env: NodeJS.ProcessEnv): SandboxConfig {
  const image = env.SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE;
  if (!/^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/.test(image) || image.endsWith(':latest')) {
    throw new Error('SANDBOX_IMAGE phải là tên image có tag hoặc digest cụ thể, không dùng :latest.');
  }
  const dockerBin = env.SANDBOX_DOCKER_BIN?.trim() || 'docker';
  if (/[\r\n\0]/.test(dockerBin)) throw new Error('SANDBOX_DOCKER_BIN không hợp lệ.');
  return {
    dockerBin, image,
    concurrency: readIntEnv(env, 'SANDBOX_CONCURRENCY', 1, 1, 2),
    memoryMb: readIntEnv(env, 'SANDBOX_MEMORY_MB', 768, 256, 1536),
    cpus: readNumberEnv(env, 'SANDBOX_CPUS', 1, 0.25, 2),
    pids: readIntEnv(env, 'SANDBOX_PIDS', 256, 32, 1024),
    tmpMb: readIntEnv(env, 'SANDBOX_TMP_MB', 64, 8, 512),
    shmMb: readIntEnv(env, 'SANDBOX_SHM_MB', 128, 16, 512),
    timeoutMs: readIntEnv(env, 'SANDBOX_TIMEOUT_MS', 45_000, 5_000, 120_000),
    recheckMs: readIntEnv(env, 'SANDBOX_RECHECK_MS', 300_000, 30_000, 3_600_000),
  };
}

export interface RunArgsOptions {
  /** Replaces the image ENTRYPOINT. Used by the self-check and by tests only. */
  entrypoint?: string;
  command?: readonly string[];
}

/** Every flag that makes the container an isolation boundary lives here, in one
 * pure function, so it can be tested and reviewed in one place. Arguments are an
 * array for spawn() without a shell; no job data is ever placed in them. */
export function buildRunArgs(config: SandboxConfig, name: string, options: RunArgsOptions = {}): string[] {
  if (!/^gc-sbx-[a-f0-9-]{36}$/.test(name)) throw new Error('Tên container không hợp lệ.');
  const memory = `${config.memoryMb}m`;
  return [
    'run', '--rm', '--init', '--pull=never',
    '--name', name,
    '--label', SANDBOX_LABEL,
    '--interactive',
    // No network at all, not even a bridge: no internet, no EC2 metadata, no LAN.
    '--network=none',
    // Unprivileged, no capabilities, no way to regain them.
    `--user=${SANDBOX_USER}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--read-only',
    // Hard resource limits. Swap equals memory so the limit cannot be exceeded via swap.
    `--memory=${memory}`, `--memory-swap=${memory}`,
    `--cpus=${config.cpus}`,
    `--pids-limit=${config.pids}`,
    '--ulimit', 'nofile=1024:1024',
    '--ulimit', 'core=0',
    // The only writable places: size-capped, non-executable memory filesystems.
    '--tmpfs', `/tmp:rw,noexec,nosuid,nodev,size=${config.tmpMb}m`,
    `--shm-size=${config.shmMb}m`,
    // Do not write container output to the host disk.
    '--log-driver=none',
    // Fixed, non-secret environment. The backend environment is never forwarded.
    '--env', 'HOME=/tmp',
    '--env', 'NODE_ENV=production',
    '--env', 'GC_CHROMIUM_SANDBOX=0',
    ...(options.entrypoint ? ['--entrypoint', options.entrypoint] : []),
    config.image,
    ...(options.command ?? []),
  ];
}
