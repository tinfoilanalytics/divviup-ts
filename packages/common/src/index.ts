import { webcrypto } from "one-webcrypto";

/** @internal */
export function integerToOctetString(i: bigint, len: number): Uint8Array {
  const max = 256n ** BigInt(len);
  if (i >= max) {
    throw new Error(
      `Integer ${i} too large for ${len} byte array (max ${max}).`
    );
  }
  const octets = new Uint8Array(len);
  for (let index = octets.length - 1; index >= 0; index--) {
    octets[index] = Number(i % 256n);
    i /= 256n;
  }
  return octets;
}

/** @internal */
export function octetStringToInteger(octetString: Uint8Array): bigint {
  return octetString.reduceRight(
    (total, value, index) =>
      total + 256n ** BigInt(octetString.length - index - 1) * BigInt(value),
    0n
  );
}

/** @internal */
export function arr<T>(length: number, mapper: (n: number) => T): T[] {
  const a = new Array(length) as T[];
  for (let i = 0; i < length; i++) a[i] = mapper(i);
  return a;
}

/** @internal */
export function fill<T>(length: number, value: T): T[] {
  return new Array(length).fill(value) as T[];
}

/** @internal */
export function nextPowerOf2(n: number): number {
  if (n > 0) {
    return 2 ** Math.ceil(Math.log2(n));
  } else {
    throw new Error("log of negative number");
  }
}

/** @internal */
export function nextPowerOf2Big(n: bigint): bigint {
  if (n === 1n) {
    return 1n;
  } else if (n > 0n) {
    return 2n ** BigInt((n - 1n).toString(2).length);
  } else {
    throw new Error("log of negative number");
  }
}

/** @internal */
export function randomBytes(n: number): Uint8Array {
  if ("TEST_VECTOR" in globalThis) {
    return Uint8Array.from(fill(n, 1));
  } else {
    const buffer = new Uint8Array(n);
    webcrypto.getRandomValues(buffer);
    return buffer;
  }
}

/** @internal */
export function zip<A, B>(a: A[], b: B[]): [A, B][] {
  if (a.length !== b.length)
    throw new Error("could not zip two unequal arrays");
  return arr(a.length, (i) => [a[i], b[i]]);
}

/** @internal */
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length)
    throw new Error("cannot xor two buffers of unequal length");
  const returnBuffer = new Uint8Array(a.length);
  for (let i = 0; i < returnBuffer.length; i++) returnBuffer[i] = a[i] ^ b[i];
  return returnBuffer;
}

/** @internal */
export function xorInPlace(
  arrayThatChanges: Uint8Array,
  arrayThatIsUnchanged: Uint8Array
) {
  if (arrayThatChanges.length !== arrayThatIsUnchanged.length)
    throw new Error("cannot xor two buffers of unequal length");

  for (let i = 0; i < arrayThatChanges.length; i++)
    arrayThatChanges[i] ^= arrayThatIsUnchanged[i];
}

/** @internal */
export function split<T extends { slice(start: number, end?: number): T }>(
  sliceable: T,
  index: number
): [T, T] {
  return [sliceable.slice(0, index), sliceable.slice(index)];
}

/** @internal */
export function concat(buffers: Uint8Array[]): Uint8Array {
  const newLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const ret = new Uint8Array(newLength);
  let writeIndex = 0;
  for (const buffer of buffers) {
    ret.set(buffer, writeIndex);
    writeIndex += buffer.byteLength;
  }
  return ret;
}