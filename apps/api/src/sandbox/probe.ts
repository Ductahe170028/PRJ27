import { existsSync, readFileSync, statfsSync, writeFileSync, unlinkSync, accessSync, constants } from 'node:fs';
import { connect } from 'node:net';
import { lookup } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import type { SandboxConfig } from './docker-args.js';

/** Facts about the container, measured from inside it. Contains no secrets: only
 * booleans, numbers and variable NAMES. */
export interface ProbeReport {
  platform: string;
  uid: number;
  gid: number;
  capEff: string;
  capBnd: string;
  noNewPrivs: number | null;
  seccomp: number | null;
  rootWritable: boolean;
  tmpWritable: boolean;
  tmpBytes: number | null;
  externalAddresses: string[];
  networkReachable: boolean;
  dnsResolves: boolean;
  dockerSocketPresent: boolean;
  hostPathsReadable: string[];
  secretEnvNames: string[];
  memoryMaxBytes: number | null;
  pidsMax: number | null;
  cpuQuota: { quota: number; period: number } | null;
  unexpectedMounts: string[];
}

const SECRET_NAME = /key|token|secret|passw|credential|aws_|session/i;
/** Paths that exist only if something from the Host was mounted in. */
const HOST_PATHS = ['/host', '/hostfs', '/mnt/host', '/mnt/c', '/Users', '/proc/1/root/etc/shadow'];
const SOCKETS = ['/var/run/docker.sock', '/run/docker.sock'];
/** Bind mounts Docker itself adds to every container. */
const DOCKER_OWN_MOUNTS = new Set(['/etc/hosts', '/etc/hostname', '/etc/resolv.conf', '/sbin/docker-init', '/usr/bin/docker-init']);
const PSEUDO_FS = new Set(['overlay', 'proc', 'tmpfs', 'devtmpfs', 'devpts', 'sysfs', 'cgroup', 'cgroup2', 'mqueue', 'shm', 'securityfs', 'debugfs', 'tracefs', 'fusectl', 'bpf', 'autofs']);

function status(field: string): string | undefined {
  try { return new RegExp(`^${field}:\\s*(\\S+)`, 'm').exec(readFileSync('/proc/self/status', 'utf8'))?.[1]; } catch { return undefined; }
}
function numberOrNull(value: string | undefined): number | null {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function writable(path: string): boolean {
  try { writeFileSync(path, 'x', { flag: 'wx' }); unlinkSync(path); return true; } catch { return false; }
}
function readText(path: string): string | undefined { try { return readFileSync(path, 'utf8').trim(); } catch { return undefined; } }

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function memoryMax(): number | null {
  const v2 = readText('/sys/fs/cgroup/memory.max');
  if (v2 !== undefined) return v2 === 'max' ? null : numberOrNull(v2);
  const v1 = numberOrNull(readText('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  return v1 !== null && v1 < 2 ** 60 ? v1 : null;
}
function pidsMax(): number | null {
  const v2 = readText('/sys/fs/cgroup/pids.max');
  if (v2 !== undefined) return v2 === 'max' ? null : numberOrNull(v2);
  return numberOrNull(readText('/sys/fs/cgroup/pids/pids.max'));
}
function cpuQuota(): { quota: number; period: number } | null {
  const v2 = readText('/sys/fs/cgroup/cpu.max')?.split(/\s+/);
  if (v2?.[0] !== undefined) {
    const quota = numberOrNull(v2[0] === 'max' ? undefined : v2[0]);
    const period = numberOrNull(v2[1]);
    return quota !== null && period !== null ? { quota, period } : null;
  }
  const quota = numberOrNull(readText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const period = numberOrNull(readText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  return quota !== null && quota > 0 && period !== null ? { quota, period } : null;
}

function unexpectedMounts(): string[] {
  const text = readText('/proc/self/mounts') ?? '';
  const found: string[] = [];
  for (const line of text.split('\n')) {
    const [, target, type] = line.split(' ');
    if (!target || !type) continue;
    if (PSEUDO_FS.has(type) || DOCKER_OWN_MOUNTS.has(target)) continue;
    found.push(`${type}:${target}`);
  }
  return found;
}

export async function collectProbeReport(): Promise<ProbeReport> {
  const tmp = (() => { try { const s = statfsSync('/tmp'); return s.bsize * s.blocks; } catch { return null; } })();
  const external = Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((address) => !address.internal).map((address) => address.address);
  const reachable = await canConnect('1.1.1.1', 443);
  const resolves = await lookup('example.com').then(() => true, () => false);
  return {
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    gid: process.getgid?.() ?? -1,
    capEff: status('CapEff') ?? 'unknown',
    capBnd: status('CapBnd') ?? 'unknown',
    noNewPrivs: numberOrNull(status('NoNewPrivs')),
    seccomp: numberOrNull(status('Seccomp')),
    rootWritable: writable('/gc-probe-root'),
    tmpWritable: writable('/tmp/gc-probe-tmp'),
    tmpBytes: tmp,
    externalAddresses: external,
    networkReachable: reachable,
    dnsResolves: resolves,
    dockerSocketPresent: SOCKETS.some((path) => existsSync(path)),
    hostPathsReadable: HOST_PATHS.filter((path) => { try { accessSync(path, constants.R_OK); return true; } catch { return false; } }),
    secretEnvNames: Object.keys(process.env).filter((name) => SECRET_NAME.test(name)),
    memoryMaxBytes: memoryMax(),
    pidsMax: pidsMax(),
    cpuQuota: cpuQuota(),
    unexpectedMounts: unexpectedMounts(),
  };
}

/** Compares what the container measured with what we configured. An empty list
 * means every checked property holds; it is evidence, not a proof of safety. */
export function evaluateProbe(report: ProbeReport, config: SandboxConfig): string[] {
  const failures: string[] = [];
  const fail = (condition: boolean, message: string) => { if (condition) failures.push(message); };
  fail(report.platform !== 'linux', `Probe không chạy trên Linux (${report.platform}).`);
  fail(report.uid === 0 || report.gid === 0 || report.uid < 0, 'Tiến trình chạy bằng root.');
  fail(!/^0+$/.test(report.capEff), `Còn Linux capability hiệu lực (CapEff=${report.capEff}).`);
  fail(!/^0+$/.test(report.capBnd), `Còn Linux capability trong bounding set (CapBnd=${report.capBnd}).`);
  fail(report.noNewPrivs !== 1, 'no-new-privileges chưa bật.');
  fail(report.seccomp !== 2, 'Chưa có seccomp filter.');
  fail(report.rootWritable, 'Root filesystem ghi được.');
  fail(!report.tmpWritable, '/tmp không ghi được (Chromium cần).');
  fail(report.tmpBytes === null || report.tmpBytes > config.tmpMb * 1024 * 1024 * 1.05, 'Dung lượng /tmp không bị giới hạn đúng.');
  fail(report.externalAddresses.length > 0, `Có giao diện mạng ngoài loopback: ${report.externalAddresses.length}.`);
  fail(report.networkReachable, 'Kết nối ra Internet thành công.');
  fail(report.dnsResolves, 'Phân giải DNS thành công.');
  fail(report.dockerSocketPresent, 'Docker socket có trong container.');
  fail(report.hostPathsReadable.length > 0, `Đọc được đường dẫn Host: ${report.hostPathsReadable.join(', ')}.`);
  fail(report.secretEnvNames.length > 0, `Biến môi trường nhạy cảm trong container: ${report.secretEnvNames.join(', ')}.`);
  fail(report.memoryMaxBytes === null || report.memoryMaxBytes > config.memoryMb * 1024 * 1024 * 1.05, 'Giới hạn RAM không đúng cấu hình.');
  fail(report.pidsMax === null || report.pidsMax > config.pids, 'Giới hạn số process không đúng cấu hình.');
  fail(report.cpuQuota === null || Math.abs(report.cpuQuota.quota / report.cpuQuota.period - config.cpus) > 0.05, 'Giới hạn CPU không đúng cấu hình.');
  fail(report.unexpectedMounts.length > 0, `Có mount ngoài mong đợi: ${report.unexpectedMounts.join(', ')}.`);
  return failures;
}
