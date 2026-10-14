import { z } from 'zod';

const flag = z.enum(['true', 'false']).default('false').transform(value => value === 'true');
const envSchema = z.object({
  API_MODE: z.enum(['mock', 'real']).default('mock'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000),
  LMS_GRAPHQL_URL: z.string().default(''), DENISE_GRAPHQL_URL: z.string().default(''),
  LMS_AUTH_HEADER: z.string().default('Authorization'), LMS_AUTH_VALUE: z.string().default(''),
  DENISE_AUTH_HEADER: z.string().default('Authorization'), DENISE_AUTH_VALUE: z.string().default(''),
  TRUSTED_PROXY_AUTH: flag,
  LOCAL_PERSONAL_MODE: flag,
  TECH_ID_HEADER: z.string().default('x-tech-id'), TECH_ROLES_HEADER: z.string().default('x-tech-roles'),
  TECH_REQUIRED_ROLE: z.string().min(1).default('homework-support'),
  REAL_MUTATIONS_ENABLED: flag, REAL_WRITE_APPROVAL: z.string().default(''),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APPROVED_TEST_LMS_IDS: z.string().default(''), APPROVED_TEST_COURSE_IDS: z.string().default(''),
});
export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const c = envSchema.parse(env);
  if (c.LOCAL_PERSONAL_MODE && (c.HOST !== '127.0.0.1' || c.APP_ENV !== 'development')) {
    throw new Error('LOCAL_PERSONAL_MODE requires HOST=127.0.0.1 and APP_ENV=development.');
  }
  for (const name of [c.LMS_AUTH_HEADER, c.DENISE_AUTH_HEADER, c.TECH_ID_HEADER, c.TECH_ROLES_HEADER]) {
    if (!/^[a-zA-Z0-9-]+$/.test(name) || ['host', 'content-length', 'content-type'].includes(name.toLowerCase())) throw new Error('Invalid header configuration.');
  }
  if (/[\r\n]/.test(c.LMS_AUTH_VALUE + c.DENISE_AUTH_VALUE)) throw new Error('Invalid authentication value.');
  if (c.API_MODE === 'real') {
    for (const endpoint of [c.LMS_GRAPHQL_URL, c.DENISE_GRAPHQL_URL]) {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Real endpoints must use HTTPS without URL credentials.');
    }
    if (!c.LMS_AUTH_VALUE || !c.DENISE_AUTH_VALUE) throw new Error('Real mode requires backend API credentials.');
  }
  return {
    ...c,
    approvedStudents: c.APPROVED_TEST_LMS_IDS.split(',').map(v => v.trim()).filter(Boolean),
    approvedCourses: c.APPROVED_TEST_COURSE_IDS.split(',').map(v => v.trim()).filter(Boolean),
  };
}
export type Config = ReturnType<typeof loadConfig>;
export function realWritesConfigured(c: Config): boolean {
  return c.API_MODE === 'real' && c.REAL_MUTATIONS_ENABLED && c.REAL_WRITE_APPROVAL === 'APPROVED_TEST_DATA_ONLY'
    && ['test', 'staging'].includes(c.APP_ENV) && c.TRUSTED_PROXY_AUTH;
}
