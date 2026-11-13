"use strict";
function createLimiter({ burst, refillPerSec }) {
  const buckets = new Map();
  return function take(key, cost = 1) {
    const now = Date.now();
    const bucket = buckets.get(key) || { tokens: burst, at: now };
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) / 1e3 * refillPerSec);
    bucket.at = now;
    if (bucket.tokens < cost) {
      buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= cost;
    buckets.set(key, bucket);
    return true;
  };
}
module.exports = { createLimiter };
