/**
 * Utilities for handling routing keys, validation, distance computation,
 * and cryptography.
 * @module kdns/keys
 */

'use strict';

const constants = require('./constants');
const crypto = require('node:crypto');
const assert = require('node:assert');


/**
 * Tests if a string is valid hex
 * @param {string} str - String to validate
 * @returns {boolean}
 */
module.exports.isHexaString = function(str) {
  return Buffer.from(str, 'hex').length === str.length / 2;
};

/**
 * Returns a random valid key/identity as a string
 * @returns {string}
 */
module.exports.getRandomKeyString = function() {
  return module.exports.getRandomKeyBuffer().toString('hex');
};

/**
 * Returns a random valid key/identity as a buffer
 * @returns {buffer}
 */
module.exports.getRandomKeyBuffer = function() {
  return crypto.randomBytes(constants.B / 8);
};

/**
 * Determines if the given string key is valid
 * @param {string} key - Node ID or item key
 * @returns {boolean}
 */
module.exports.keyStringIsValid = function(key) {
  let buf;

  try {
    buf = Buffer.from(key, 'hex');
  } catch (err) {
    return false;
  }

  return module.exports.keyBufferIsValid(buf);
};

/**
 * Determines if the given buffer key is valid
 * @param {buffer} key - Node ID or item key
 * @returns {boolean}
 */
module.exports.keyBufferIsValid = function(key) {
  return Buffer.isBuffer(key) && key.length === constants.B / 8;
};

/**
 * Calculate the distance between two keys
 * @param {string} key1 - Identity key to compare
 * @param {string} key2 - Identity key to compare
 * @returns {buffer}
 */
module.exports.getDistance = function(id1, id2) {
  id1 = !Buffer.isBuffer(id1)
    ? Buffer.from(id1, 'hex')
    : id1;
  id2 = !Buffer.isBuffer(id2)
    ? Buffer.from(id2, 'hex')
    : id2;

  assert(module.exports.keyBufferIsValid(id1), 'Invalid key supplied');
  assert(module.exports.keyBufferIsValid(id2), 'Invalid key supplied');

  return Buffer.alloc(constants.B / 8)
    .map((b, index) => id1[index] ^ id2[index]);
};

/**
 * Compare two buffers for sorting
 * @param {buffer} b1 - Buffer to compare
 * @param {buffer} b2 - Buffer to compare
 * @returns {number}
 */
module.exports.compareKeyBuffers = function(b1, b2) {
  assert(module.exports.keyBufferIsValid(b1), 'Invalid key supplied');
  assert(module.exports.keyBufferIsValid(b2), 'Invalid key supplied');

  for (let index = 0; index < b1.length; index++) {
    let bits = b1[index];

    if (bits !== b2[index]) {
      return bits < b2[index] ? -1 : 1;
    }
  }

  return 0;
};

/**
 * Calculate the index of the bucket that key would belong to
 * @param {string} referenceKey - Key to compare
 * @param {string} foreignKey - Key to compare
 * @returns {number}
 */
module.exports.getBucketIndex = function(referenceKey, foreignKey) {
  let distance = module.exports.getDistance(referenceKey, foreignKey);
  let bucketIndex = constants.B;

  for (let byteValue of distance) {
    if (byteValue === 0) {
      bucketIndex -= 8;
      continue;
    }

    for (let i = 0; i < 8; i++) {
      if (byteValue & (0x80 >> i)) {
        return --bucketIndex;
      } else {
        bucketIndex--;
      }
    }
  }

  return bucketIndex;
};

/**
 * Returns a buffer with a power-of-two value given a bucket index
 * @param {string|buffer} referenceKey - Key to find next power of two
 * @param {number} bucketIndex - Bucket index for key
 * @returns {buffer}
 */
module.exports.getPowerOfTwoBufferForIndex = function(referenceKey, exp) {
  assert(exp >= 0 && exp < constants.B, 'Index out of range');

  const buffer = Buffer.isBuffer(referenceKey)
    ? Buffer.from(referenceKey)
    : Buffer.from(referenceKey, 'hex');
  const byteValue = parseInt(exp / 8);

  // NB: We set the byte containing the bit to the right left shifted amount
  buffer[constants.K - byteValue - 1] = 1 << (exp % 8);

  return buffer;
};

/**
 * Generate a random number within the bucket's range
 * @param {buffer} referenceKey - Key for bucket distance reference
 * @param {number} index - Bucket index for random buffer selection
 */
module.exports.getRandomBufferInBucketRange = function(referenceKey, index) {
  let base = module.exports.getPowerOfTwoBufferForIndex(referenceKey, index);
  let byte = parseInt(index / 8); // NB: Randomize bytes below the power of two

  for (let i = constants.K - 1; i > (constants.K - byte - 1); i--) {
    base[i] = parseInt(Math.random() * 256);
  }

  // NB: Also randomize the bits below the number in that byte and remember
  // NB: arrays are off by 1
  for (let j = index - 1; j >= byte * 8; j--) {
    let one = Math.random() >= 0.5;
    let shiftAmount = j - byte * 8;

    base[constants.K - byte - 1] |= one ? (1 << shiftAmount) : 0;
  }

  return base;
};

/**
 * Returns the SHA-256 hash of the input
 * @param {buffer} input - Data to hash
 */
module.exports.hash256 = function(input) {
  return crypto.createHash('sha256').update(input).digest();
};

/**
 * Returns the RMD-160 hash of the input
 * @param {buffer} input - Data to hash
 */
module.exports.hash160 = function(input) {
  return crypto.createHash('ripemd160').update(input).digest();
};

/**
 * Converts a buffer to a string representation of binary
 * @param {buffer} buffer - Byte array to convert to binary string
 * @returns {string}
 */
module.exports.toBinaryStringFromBuffer = function(buffer) {
  const mapping = {
    '0': '0000',
    '1': '0001',
    '2': '0010',
    '3': '0011',
    '4': '0100',
    '5': '0101',
    '6': '0110',
    '7': '0111',
    '8': '1000',
    '9': '1001',
    'a': '1010',
    'b': '1011',
    'c': '1100',
    'd': '1101',
    'e': '1110',
    'f': '1111'
  };
  const hexaString = buffer.toString('hex').toLowerCase();
  const bitmaps = [];

  for (let i = 0; i < hexaString.length; i++) {
    bitmaps.push(mapping[hexaString[i]]);
  }

  return bitmaps.join('');
};

