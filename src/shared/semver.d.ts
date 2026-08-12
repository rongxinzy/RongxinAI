declare module 'semver' {
  export function valid(version: string): string | null;
  export function gt(version: string, otherVersion: string): boolean;
  export function lt(version: string, otherVersion: string): boolean;
}
