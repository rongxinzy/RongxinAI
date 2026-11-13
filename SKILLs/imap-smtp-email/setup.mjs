#!/usr/bin/env node
/**
 * IMAP/SMTP Email Skill Setup Helper (cross-platform Node.js).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROVIDERS = {
  '1': {
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    smtpSecure: 'false',
    imapTls: 'true',
  },
  '2': {
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
    smtpSecure: 'false',
    imapTls: 'true',
  },
  '3': {
    imapHost: 'imap.163.com',
    imapPort: '993',
    smtpHost: 'smtp.163.com',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '4': {
    imapHost: 'imap.vip.163.com',
    imapPort: '993',
    smtpHost: 'smtp.vip.163.com',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '5': {
    imapHost: 'imap.126.com',
    imapPort: '993',
    smtpHost: 'smtp.126.com',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '6': {
    imapHost: 'imap.vip.126.com',
    imapPort: '993',
    smtpHost: 'smtp.vip.126.com',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '7': {
    imapHost: 'imap.188.com',
    imapPort: '993',
    smtpHost: 'smtp.188.com',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '8': {
    imapHost: 'imap.vip.188.com',
    imapPort: '993',
    smtpHost: 'smtp.vip.188.com',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '9': {
    imapHost: 'imap.yeah.net',
    imapPort: '993',
    smtpHost: 'smtp.yeah.net',
    smtpPort: '465',
    smtpSecure: 'true',
    imapTls: 'true',
  },
  '10': {
    imapHost: 'imap.qq.com',
    imapPort: '993',
    smtpHost: 'smtp.qq.com',
    smtpPort: '587',
    smtpSecure: 'false',
    imapTls: 'true',
  },
};

function ensureDependencies() {
  if (fs.existsSync(path.join(__dirname, 'node_modules'))) {
    return true;
  }

  console.log('Installing npm dependencies...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['install'], {
    cwd: __dirname,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('Failed to install dependencies. Please ensure Node.js/npm is installed.');
    return false;
  }
  console.log('Dependencies installed successfully');
  return true;
}

function runNodeScript(relativeScript, args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, relativeScript), ...args], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
    stdio: 'ignore',
  });
  return result.status === 0;
}

async function main() {
  process.chdir(__dirname);
  if (!ensureDependencies()) {
    process.exit(1);
  }

  console.log('================================');
  console.log('  IMAP/SMTP Email Skill Setup');
  console.log('================================\n');
  console.log('This script will help you create a .env file with your email credentials.\n');
  console.log('Select your email provider:');
  console.log('  1) Gmail');
  console.log('  2) Outlook');
  console.log('  3) 163.com');
  console.log('  4) vip.163.com');
  console.log('  5) 126.com');
  console.log('  6) vip.126.com');
  console.log('  7) 188.com');
  console.log('  8) vip.188.com');
  console.log('  9) yeah.net');
  console.log(' 10) QQ Mail');
  console.log(' 11) Custom\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const choice = (await rl.question('Enter choice (1-11): ')).trim();
    let cfg = PROVIDERS[choice];

    if (!cfg && choice === '11') {
      cfg = {
        imapHost: (await rl.question('IMAP Host: ')).trim(),
        imapPort: (await rl.question('IMAP Port: ')).trim(),
        smtpHost: (await rl.question('SMTP Host: ')).trim(),
        smtpPort: (await rl.question('SMTP Port: ')).trim(),
        imapTls: (await rl.question('Use TLS for IMAP? (true/false): ')).trim(),
        smtpSecure: (await rl.question('Use SSL for SMTP? (true/false): ')).trim(),
      };
    }

    if (!cfg) {
      console.error('Invalid choice');
      process.exit(1);
    }

    const email = (await rl.question('\nEmail address: ')).trim();
    const password = await rl.question('Password / App Password / Authorization Code: ');
    let rejectUnauthorized = process.env.REJECT_UNAUTHORIZED || '';
    if (!rejectUnauthorized) {
      const acceptCert = (await rl.question('Accept self-signed certificates? (y/n): ')).trim().toLowerCase();
      rejectUnauthorized = acceptCert === 'y' ? 'false' : 'true';
    }

    const envContent = [
      '# IMAP Configuration',
      `IMAP_HOST=${cfg.imapHost}`,
      `IMAP_PORT=${cfg.imapPort}`,
      `IMAP_USER=${email}`,
      `IMAP_PASS=${password}`,
      `IMAP_TLS=${cfg.imapTls}`,
      `IMAP_REJECT_UNAUTHORIZED=${rejectUnauthorized}`,
      'IMAP_MAILBOX=INBOX',
      '',
      '# SMTP Configuration',
      `SMTP_HOST=${cfg.smtpHost}`,
      `SMTP_PORT=${cfg.smtpPort}`,
      `SMTP_SECURE=${cfg.smtpSecure}`,
      `SMTP_USER=${email}`,
      `SMTP_PASS=${password}`,
      `SMTP_FROM=${email}`,
      `SMTP_REJECT_UNAUTHORIZED=${rejectUnauthorized}`,
      '',
    ].join('\n');

    fs.writeFileSync(path.join(__dirname, '.env'), envContent, 'utf8');
    console.log('\nCreated .env file\n');
    console.log('Testing connections...\n');
    console.log('Testing IMAP...');
    if (runNodeScript('scripts/imap.js', ['list-mailboxes'])) {
      console.log('IMAP connection successful!');
    } else {
      console.log('IMAP connection test failed. Please check your credentials and settings.');
    }

    console.log('\nTesting SMTP...');
    if (runNodeScript('scripts/smtp.js', ['test'])) {
      console.log('SMTP connection successful!');
    } else {
      console.log('SMTP connection test failed. Please check your credentials and settings.');
    }

    console.log('\nSetup complete! Try:');
    console.log('  node scripts/imap.js check');
    console.log("  node scripts/smtp.js send --to recipient@example.com --subject Test --body 'Hello World'");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
