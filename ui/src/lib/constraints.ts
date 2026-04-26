export const MIN_NAME_LENGTH = 2;

export function minimumLengthMessage(label: string, minLength = MIN_NAME_LENGTH): string {
  return `${label} must be at least ${minLength} characters.`;
}