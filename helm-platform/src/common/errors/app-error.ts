import { HttpException, HttpStatus } from '@nestjs/common';
/** Standard error envelope (blueprint H). */
export class AppError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, details?: unknown) {
    super({ error: { code, message, details } }, status);
  }
}
export const Errors = {
  notFound: (msg = 'Not found') => new AppError('not_found', msg, HttpStatus.NOT_FOUND),
  forbidden: (msg = 'Forbidden') => new AppError('forbidden', msg, HttpStatus.FORBIDDEN),
  conflict: (msg = 'Version mismatch') => new AppError('version_mismatch', msg, HttpStatus.CONFLICT),
  releaseNotPromotable: (details: unknown) =>
    new AppError('release_not_promotable', 'Release failed preflight checks', HttpStatus.UNPROCESSABLE_ENTITY, details),
  freezeActive: (msg = 'Change freeze in effect') => new AppError('freeze_active', msg, HttpStatus.CONFLICT),
  approvalRequired: (msg = 'Approval requirements not met') => new AppError('approval_required', msg, HttpStatus.FORBIDDEN),
};
