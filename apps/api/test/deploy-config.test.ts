// Static checks of the files in deploy/. They cannot replace `nginx -t` or the
// live checks in deploy/README.md, but they stop silent drift between files.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

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

  it('waits for the AI longer than the browser does (60 s), and no longer than a request can run', () => {
    const timeout = Number(/proxy_read_timeout (\d+)s;/.exec(apiLocation)?.[1]);
    expect(timeout).toBeGreaterThan(60);
    expect(timeout).toBeLessThanOrEqual(120);
    expect(conf).not.toMatch(/NDJSON|agent|sandbox|advanced/i);
  });

  it('denies dotfiles and uses modern TLS only', () => {
    expect(https).toMatch(/location ~ \/\\\. \{\s*deny all;/);
    expect(https).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
  });
});

describe('environment template', () => {
  const sample = read('apps/api/.env.example');
  it('documents every variable the backend reads, with no secret values', () => {
    for (const name of ['HOST', 'PORT', 'CLIENT_ORIGINS', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'GEMINI_ALLOWED_MODELS', 'GROQ_ALLOWED_MODELS',
      'AI_REQUESTS_PER_MINUTE', 'AI_REQUESTS_PER_DAY', 'AI_MAX_CONCURRENT', 'AI_TIMEOUT_MS', 'TRUST_PROXY']) {
      expect(sample, name).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
    }
    expect(sample).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}/);
    expect(sample).toMatch(/^GEMINI_API_KEY=$/m);
    expect(sample).toMatch(/^GROQ_API_KEY=$/m);
  });

  it('says nothing of the removed code agent, its queue or its sandbox', () => {
    expect(sample).not.toMatch(/ADVANCED|SANDBOX|GAME_JOB|agent|Docker/i);
  });
});
