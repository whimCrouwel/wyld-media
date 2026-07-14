export type ClassInput = string | false | null | undefined;

/**
 * Joins truthy class-name inputs with a single space.
 * Zero-dependency stand-in for clsx; append passthrough `class` last.
 */
export function cn(...inputs: ClassInput[]): string {
  return inputs.filter(Boolean).join(' ');
}
