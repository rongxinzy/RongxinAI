const { execFileSync } = require('child_process');
const { notarize } = require('@electron/notarize');
const path = require('path');

// Load .env when dotenv is available, but do not require it for packaging.
try {
  require('dotenv').config();
} catch (error) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

/** How many times the ticket staple is retried after a successful notarization. */
const STAPLE_ATTEMPTS = 3;
const STAPLE_RETRY_DELAYS_MS = [10_000, 30_000];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Whether a notarization error came from stapling the ticket rather than from the
 * submission itself. Stapling asks Apple's CloudKit for the finished ticket and
 * fails intermittently from CI (`Code=-1005 "The network connection was lost."`,
 * `The staple and validate action failed! Error 68`), while the app is already
 * notarized at that point.
 */
const looksLikeStapleFailure = message =>
  /staple|stapler|cloudkit|NSURLErrorDomain|network connection was lost|Code=-1\d{3}/i.test(
    message,
  );

/**
 * Staples the ticket, retrying the transient failures Apple's service produces.
 *
 * `deps` exists for the unit tests: they drive the retry loop without a macOS
 * runner (the production call site passes nothing).
 */
async function stapleWithRetry(appPath, deps = {}) {
  const run =
    deps.run ??
    (() => execFileSync('xcrun', ['stapler', 'staple', '-v', appPath], { stdio: 'inherit' }));
  const wait = deps.wait ?? delay;
  for (let attempt = 1; attempt <= STAPLE_ATTEMPTS; attempt += 1) {
    try {
      run();
      return;
    } catch (error) {
      if (attempt === STAPLE_ATTEMPTS) {
        throw error;
      }
      const waitMs = STAPLE_RETRY_DELAYS_MS[attempt - 1] ?? STAPLE_RETRY_DELAYS_MS.at(-1);
      console.warn(
        `   票据 staple 第 ${attempt} 次失败: ${error.message}；${Math.round(waitMs / 1000)}s 后重试`,
      );
      await wait(waitMs);
    }
  }
}

/**
 * `deps` lets the unit tests drive the failure paths (a macOS runner is not
 * available on the developer machines); electron-builder calls this with the
 * context only.
 */
exports.default = async function notarizing(context, deps = {}) {
  const notarizeApp = deps.notarize ?? notarize;
  const stapleTicket = deps.staple ?? stapleWithRetry;
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.warn('⚠️  跳过公证: 未设置 APPLE_ID 或 APPLE_APP_SPECIFIC_PASSWORD');
    console.warn('   如需启用公证，请创建 .env 文件并配置 Apple Developer 凭据');
    console.warn('   参考 .env.example 模板');
    return;
  }

  if (!process.env.APPLE_TEAM_ID) {
    console.warn('⚠️  跳过公证: 未设置 APPLE_TEAM_ID');
    console.warn('   公证需要 APPLE_TEAM_ID');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔐 正在公证 ${appName}...`);
  console.log(`   应用路径: ${appPath}`);

  try {
    await notarizeApp({
      appPath: appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });

    console.log('✅ 公证成功！');
    console.log('   应用已签名并通过公证，可以分发给用户');
  } catch (error) {
    if (!looksLikeStapleFailure(String(error && error.message))) {
      console.error('❌ 公证失败:', error.message);
      console.error('   请检查 Apple Developer 凭据并重试');
      console.error('   访问 https://appstoreconnect.apple.com/notarization-history 查看详情');
      throw error;
    }

    // The submission already succeeded, so staple directly instead of resubmitting
    // (Apple rate-limits submissions, and a second run would pay the whole wait again).
    console.warn(`⚠️  公证已通过但票据 staple 失败: ${error.message}`);
    console.warn('   直接重试 staple（不重新提交公证）...');
    await stapleTicket(appPath);
    console.log('✅ 公证成功（票据已补 staple）');
  }
};

exports.looksLikeStapleFailure = looksLikeStapleFailure;
exports.stapleWithRetry = stapleWithRetry;
