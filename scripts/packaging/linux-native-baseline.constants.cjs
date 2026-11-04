'use strict';

/** Docker image used to compile Linux Electron native modules for release packages. */
const LINUX_NATIVE_BUILD_IMAGE = 'ubuntu:22.04';

/**
 * glibc shipped by Ubuntu 22.04. Binaries built in that image must not require a
 * newer GLIBC_* symbol version than this baseline.
 */
const LINUX_NATIVE_GLIBC_BASELINE = '2.35';

module.exports = {
  LINUX_NATIVE_BUILD_IMAGE,
  LINUX_NATIVE_GLIBC_BASELINE,
};
