export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'error',
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, 'bad_request', details)
export const unauthorized = (message = 'Please sign in.') => new AppError(401, message, 'unauthorized')
export const forbidden = (message = 'You do not have access to this document.') => new AppError(403, message, 'forbidden')
export const notFound = (message = 'Document not found.') => new AppError(404, message, 'not_found')
export const conflict = (message: string, details?: unknown) => new AppError(409, message, 'conflict', details)
