const baseConfig = require('./electron-builder.json');

const certificateThumbprint = (process.env.CERTUM_CERT_THUMBPRINT || '')
  .replace(/[^0-9a-f]/gi, '')
  .toUpperCase();

if (!/^[0-9A-F]{40}$/.test(certificateThumbprint)) {
  throw new Error(
    'CERTUM_CERT_THUMBPRINT must contain the 40-character SHA-1 thumbprint for the release certificate.',
  );
}

module.exports = {
  ...baseConfig,
  win: {
    ...baseConfig.win,
    signtoolOptions: {
      certificateSha1: certificateThumbprint,
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://time.certum.pl',
    },
  },
};
