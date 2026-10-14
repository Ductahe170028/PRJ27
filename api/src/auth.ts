import type { Request } from 'express';
import type { Config } from './config.js';
import { AppError } from './errors.js';

export interface Actor { id: string; canRead: boolean; canReopen: boolean }
export function authenticate(req: Request, config: Config): Actor {
  if (config.API_MODE === 'mock') return { id: 'mock-tech', canRead: true, canReopen: true };
  if (config.LOCAL_PERSONAL_MODE) {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (config.HOST !== '127.0.0.1' || config.APP_ENV !== 'development' || !loopback || !/^127\.0\.0\.1(?::\d+)?$/.test(req.get('host') ?? '')) {
      throw new AppError(403, 'LOCAL_ONLY', 'Chế độ cá nhân chỉ cho phép truy cập qua 127.0.0.1 trong môi trường development.');
    }
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== config.WEB_ORIGIN)) {
      throw new AppError(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không được cho phép.');
    }
    return { id: 'local-personal', canRead: true, canReopen: true };
  }
  if (!config.TRUSTED_PROXY_AUTH) throw new AppError(401, 'AUTH_NOT_CONFIGURED', 'Chưa cấu hình xác thực Tech qua gateway nội bộ.');
  const id = req.get(config.TECH_ID_HEADER);
  const roles = (req.get(config.TECH_ROLES_HEADER) ?? '').split(',').map(v => v.trim());
  if (!id || !/^[a-zA-Z0-9@._-]{1,128}$/.test(id)) throw new AppError(401, 'UNAUTHENTICATED', 'Cần đăng nhập qua gateway nội bộ.');
  if (!roles.includes(config.TECH_REQUIRED_ROLE)) throw new AppError(403, 'FORBIDDEN', 'Tài khoản không có quyền hỗ trợ Homework Reopen.');
  return { id, canRead: true, canReopen: true };
}
export function assertRead(actor: Actor) {
  if (!actor.canRead) throw new AppError(403, 'FORBIDDEN', 'Không có quyền đọc dữ liệu học viên.');
}
