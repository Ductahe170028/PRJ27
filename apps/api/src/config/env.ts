/** Strict numeric environment settings. A bad value stops start-up instead of
 * silently falling back, because these values bound server resources. */
export function readIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} phải là số nguyên từ ${min} đến ${max}.`);
  }
  return value;
}

/** A positive decimal such as CPU count. */
export function readNumberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} phải là số từ ${min} đến ${max}.`);
  }
  return value;
}
