// Static checks of the files in deploy/. They cannot replace `nginx -t` or the
// live checks in deploy/README.md, but they stop silent drift between files.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SANDBOX_IMAGE, SANDBOX_ENTRY_DIR, SANDBOX_PLAYWRIGHT_VERSION, SANDBOX_USER } from '../src/sandbox/docker-args.js';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };

/** Returns the text of the top-level `server { ... }` blocks. */
function serverBlocks(conf: string): string[] {
  const blocks: string[] = [];
  for (const match of conf.matchAll(/^server\s*\{/gm)) {
    let depth = 0; let index = match.index + match[0].length - 1;
    for (; index < conf.length; index += 1) {
      if (conf[index] === '{') depth += 1;
      if (conf[index] === '}' && --depth === 0) break;
    }
    blocks.push(conf.slice(match.index, index + 1));
  }
  return blocks;
}
const directives = (block: string) => block.split('\n').map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean);

describe('deploy/nginx/gamecreator.conf', () => {
  const conf = read('deploy/nginx/gamecreator.conf');
  const [http, https] = serverBlocks(conf);
  const apiLocation = /location \^~ \/api\/ \{[\s\S]*?\n    \}/.exec(https ?? '')?.[0] ?? '';

  it('has one HTTP server that only redirects and one HTTPS server', () => {
    expect(serverBlocks(conf)).toHaveLength(2);
    const lines = directives(http!);
    expect(lines).toContain('listen 80;');
    expect(lines.join('\n')).not.toMatch(/proxy_pass|auth_basic off|root \/var\/www\/gamecreator/);
    expect(http).toContain('return 301 https://$host$request_uri;');
    expect(https).toMatch(/listen 443 ssl/);
  });

  it('requires Basic Auth for the whole HTTPS site from the server level, never switched off', () => {
    expect(directives(https!)).toContain('auth_basic "GameCreator";');
    expect(directives(https!)).toContain('auth_basic_user_file /etc/nginx/.htpasswd-gamecreator;');
    expect(conf).not.toMatch(/auth_basic\s+off/);
    // auth_basic is declared once, at server level, so every location inherits it.
    expect(https!.match(/auth_basic\s+"/g)).toHaveLength(1);
    expect(apiLocation).not.toContain('auth_basic');
  });

  it('keeps the password hash out of the repository', () => {
    expect(conf).not.toMatch(/\$apr1\$|\$2[aby]\$|\{SHA\}/);
    expect(read('.gitignore')).toMatch(/\.htpasswd/);
  });

  it('proxies every /api/ path to the loopback backend only', () => {
    expect(apiLocation).not.toBe('');
    const proxies = [...conf.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
    expect(proxies).toEqual(['http://127.0.0.1:3001']);
  });

  it('does not forward credentials to the backend', () => {
    expect(apiLocation).toContain('proxy_set_header Authorization "";');
    expect(apiLocation).toContain('proxy_set_header Proxy-Authorization "";');
  });

  it('clears the other forwarding headers Express could read from a client', () => {
    expect(apiLocation).toContain('proxy_set_header X-Forwarded-Host "";');
    expect(apiLocation).toContain('proxy_set_header Forwarded "";');
    expect(apiLocation).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
  });

  it('overwrites the client address headers and the Host header instead of relaying client values', () => {
    expect(apiLocation).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(apiLocation).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(apiLocation).toContain('proxy_set_header Host $server_name;');
    expect(apiLocation).not.toMatch(/\$proxy_add_x_forwarded_for|\$http_x_forwarded_for|\$http_host|\$host;/);
    expect(apiLocation).not.toMatch(/Host\s+(localhost|127\.0\.0\.1)/);
  });

  it('rate limits per IP, caps connections and the request body, and answers 429', () => {
    expect(conf).toMatch(/limit_req_zone \$binary_remote_addr zone=gc_api:\w+ rate=30r\/m;/);
    expect(apiLocation).toContain('limit_req zone=gc_api burst=10 nodelay;');
    expect(apiLocation).toContain('limit_conn gc_conn 8;');
    expect(apiLocation).toContain('limit_req_status 429;');
    expect(directives(https!)).toContain('client_max_body_size 16k;');
    expect(directives(https!)).toContain('limit_req zone=gc_site burst=40 nodelay;');
  });

  it('streams NDJSON unbuffered and waits longer than the longest silent gap', () => {
    expect(apiLocation).toContain('proxy_buffering off;');
    const timeout = Number(/proxy_read_timeout (\d+)s;/.exec(apiLocation)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(300);
  });

  it('denies dotfiles and uses modern TLS only', () => {
    expect(https).toMatch(/location ~ \/\\\. \{\s*deny all;/);
    expect(https).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
  });
});

describe('sandbox image definition', () => {
  const dockerfile = read('deploy/sandbox/Dockerfile');
  const defaultArg = /^ARG PLAYWRIGHT_VERSION=(\S+)/m.exec(dockerfile)?.[1];

  it('pins one Playwright version everywhere: Dockerfile, lockfile, API package and default image tag', () => {
    const api = JSON.parse(read('apps/api/package.json')) as { dependencies: Record<string, string> };
    expect(defaultArg).toBe(SANDBOX_PLAYWRIGHT_VERSION);
    expect(lock.packages['node_modules/playwright']?.version).toBe(SANDBOX_PLAYWRIGHT_VERSION);
    expect(lock.packages['node_modules/playwright-core']?.version).toBe(SANDBOX_PLAYWRIGHT_VERSION);
    expect(lock.packages['node_modules/@playwright/test']?.version).toBe(SANDBOX_PLAYWRIGHT_VERSION);
    expect(api.dependencies.playwright).toMatch(new RegExp(`^\\^?${SANDBOX_PLAYWRIGHT_VERSION.replace(/\./g, '\\.')}$`));
    expect(DEFAULT_SANDBOX_IMAGE).toBe(`gamecreator-sandbox:pw${SANDBOX_PLAYWRIGHT_VERSION}`);
  });

  it('uses the pinned Playwright base image, not latest', () => {
    expect(dockerfile).toMatch(/^FROM mcr\.microsoft\.com\/playwright:v\$\{PLAYWRIGHT_VERSION\}-noble$/m);
    expect(dockerfile).not.toMatch(/:latest|jammy|focal/);
  });

  it('installs the exact zod version the contracts package resolves', () => {
    const zod = /^ARG ZOD_VERSION=(\S+)/m.exec(dockerfile)?.[1];
    expect(zod).toBe(lock.packages['packages/contracts/node_modules/zod']?.version ?? lock.packages['node_modules/zod']?.version);
  });

  it('drops to the same unprivileged user the run command uses and starts the runner', () => {
    expect(dockerfile).toContain(`USER ${SANDBOX_USER}`);
    expect(dockerfile).toContain(`ENTRYPOINT ["node", "${SANDBOX_ENTRY_DIR}/runner-main.js"]`);
    expect(dockerfile).toMatch(/chmod -R a=rX \/opt\/gc/);
  });

  it('copies only built artefacts and keeps secrets out of the build context', () => {
    const copies = [...dockerfile.matchAll(/^COPY (\S+)/gm)].map((match) => match[1]);
    expect(copies).toEqual(['packages/contracts/package.json', 'packages/contracts/dist', 'apps/api/package.json', 'apps/api/dist', 'apps/web/public/runtime/advanced.js']);
    const ignore = read('.dockerignore');
    expect(ignore.split('\n')).toContain('*'); // allow-list: everything is excluded unless re-included
    expect(ignore).toMatch(/^\*\*\/\.env$/m);
    const instructions = dockerfile.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    expect(instructions).not.toMatch(/\.env|GROQ|GEMINI|API_KEY|COPY \. /);
  });
});

describe('environment template', () => {
  it('documents every variable the backend reads for the queue, proxy and sandbox, with no secret values', () => {
    const sample = read('apps/api/.env.example');
    for (const name of ['TRUST_PROXY', 'GAME_JOB_CONCURRENCY', 'GAME_JOB_MAX_QUEUE', 'GAME_JOB_TIMEOUT_MS', 'GAME_JOB_MAX_WAIT_MS', 'GAME_JOB_MAX_PER_IP',
      'ADVANCED_TESTER', 'SANDBOX_IMAGE', 'SANDBOX_CONCURRENCY', 'SANDBOX_MEMORY_MB', 'SANDBOX_CPUS', 'SANDBOX_PIDS', 'SANDBOX_TMP_MB', 'SANDBOX_SHM_MB', 'SANDBOX_TIMEOUT_MS', 'SANDBOX_RECHECK_MS']) {
      expect(sample, name).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
    }
    expect(sample).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}/);
  });
});
