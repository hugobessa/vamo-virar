export const getRandomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
