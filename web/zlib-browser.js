import {
  gunzipSync as fflateGunzipSync,
  gzipSync as fflateGzipSync,
} from 'fflate';

export const constants = Object.freeze({
  Z_BEST_COMPRESSION: 9,
  Z_BEST_SPEED: 1,
  Z_DEFAULT_COMPRESSION: -1,
});

export function gunzipSync(input, options = {}) {
  const output = fflateGunzipSync(input);
  if (options.maxOutputLength && output.length > options.maxOutputLength) {
    throw new RangeError(`decompressed data exceeds limit (${options.maxOutputLength} bytes)`);
  }
  return output;
}

export function gzipSync(input, options = {}) {
  const level = options.level === constants.Z_DEFAULT_COMPRESSION
    ? undefined
    : options.level;
  return fflateGzipSync(input, level === undefined ? {} : { level });
}
