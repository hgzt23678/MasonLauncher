const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electronPath = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const verifierPath = path.join(__dirname, 'verify-minecraft-launches.cjs');
const targets =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        'vanilla:1.16.5',
        'vanilla:1.20.4',
        'vanilla:1.21.1',
        'vanilla:26.1.2',
      ];

const appData = process.env.APPDATA;
if (!appData) {
  console.error('APPDATA is not available.');
  process.exit(1);
}

const userData =
  process.env.MASON_VERIFY_USER_DATA?.trim() ||
  path.join(appData, 'Mason Launcher');
const finalResultPath =
  process.env.MASON_VERIFY_RESULT_PATH?.trim() ||
  path.join(userData, 'verification-results.json');
const finalProgressPath =
  process.env.MASON_VERIFY_PROGRESS_PATH?.trim() ||
  path.join(userData, 'verification-progress.log');
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'mason-verification-'),
);
const combinedResults = [];
const combinedProgress = [];
let failed = false;

try {
  for (const [index, target] of targets.entries()) {
    const resultPath = path.join(temporaryRoot, `${index}-result.json`);
    const progressPath = path.join(temporaryRoot, `${index}-progress.log`);
    const child = spawnSync(electronPath, [verifierPath, target], {
      cwd: projectRoot,
      env: {
        ...process.env,
        MASON_VERIFY_RESULT_PATH: resultPath,
        MASON_VERIFY_PROGRESS_PATH: progressPath,
      },
      stdio: 'inherit',
      windowsHide: false,
    });

    if (child.error) {
      console.error(`Verification process failed for ${target}:`, child.error);
      failed = true;
    }
    if (child.status !== 0) {
      failed = true;
    }

    if (fs.existsSync(resultPath)) {
      const targetResults = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      combinedResults.push(...targetResults);
      if (targetResults.some((result) => result.success !== true)) {
        failed = true;
      }
    } else {
      combinedResults.push({
        versionId: target,
        minecraftVersion: target.split(':')[1] || target,
        loader: target.split(':')[0] || 'vanilla',
        success: false,
        error: `Verification process exited without a result (status=${child.status ?? 'none'}, signal=${child.signal ?? 'none'}).`,
      });
      failed = true;
    }

    if (fs.existsSync(progressPath)) {
      combinedProgress.push(fs.readFileSync(progressPath, 'utf8').trimEnd());
    }
  }

  fs.mkdirSync(path.dirname(finalResultPath), { recursive: true });
  fs.writeFileSync(
    finalResultPath,
    JSON.stringify(combinedResults, null, 2),
    'utf8',
  );
  fs.mkdirSync(path.dirname(finalProgressPath), { recursive: true });
  fs.writeFileSync(
    finalProgressPath,
    `${combinedProgress.filter(Boolean).join('\n')}\n`,
    'utf8',
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(`VERIFY_MATRIX_RESULTS ${JSON.stringify(combinedResults)}`);
process.exit(failed ? 1 : 0);
