export type TrustProxySetting = 'loopback' | false;

/** Express may only believe X-Forwarded-For when the TCP peer is our own Nginx.
 * The backend binds 127.0.0.1, so the only legitimate proxy is on loopback and
 * Nginx overwrites the header with $remote_addr. `true`, a hop count or a
 * subnet list would let any other peer choose the client address, so none are
 * accepted. Unset: loopback in production (behind Nginx), off for local dev. */
export function resolveTrustProxy(env: NodeJS.ProcessEnv): TrustProxySetting {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === undefined || raw === '') return env.NODE_ENV === 'production' ? 'loopback' : false;
  if (raw === 'loopback') return 'loopback';
  if (raw === 'off' || raw === 'false' || raw === '0') return false;
  throw new Error('TRUST_PROXY chỉ nhận "loopback" hoặc "off".');
}
