export const success = <T>(data: T) => ({
  success: true as const,
  data,
});

export const error = (message: string, code = 'ERROR') => ({
  success: false as const,
  error: message,
  code,
});
