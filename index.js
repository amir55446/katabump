// ============================================================
//   Launcher - تحميل Chrome وتشغيل البوت
// ============================================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// مسارات Chrome المحتملة على السيرفر
const CHROME_PATHS = [
  '/home/container/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome',
  '/root/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

// دور على Chrome موجود
let foundChrome = CHROME_PATHS.find(p => fs.existsSync(p));

if (!foundChrome) {
  try {
    console.log("⏳ جاري تحميل متصفح كروم...");
    execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
    console.log("✅ تم التحميل بنجاح!");
    // دور تاني بعد التحميل
    foundChrome = CHROME_PATHS.find(p => fs.existsSync(p));
    // لو لسه مش موجود دور في المجلد
    if (!foundChrome) {
      const baseDir = '/home/container/.cache/puppeteer/chrome';
      const baseDir2 = '/root/.cache/puppeteer/chrome';
      for (const base of [baseDir, baseDir2]) {
        if (fs.existsSync(base)) {
          const versions = fs.readdirSync(base);
          for (const v of versions) {
            const p = path.join(base, v, 'chrome-linux64', 'chrome');
            if (fs.existsSync(p)) { foundChrome = p; break; }
          }
        }
        if (foundChrome) break;
      }
    }
  } catch (error) {
    console.log("⚠️ تعذر تحميل كروم، سيتم المحاولة بدونه.");
  }
}

if (foundChrome) {
  process.env.PUPPETEER_EXECUTABLE_PATH = foundChrome;
  console.log(`✅ Chrome: ${foundChrome}`);
} else {
  console.warn("⚠️ لم يتم العثور على Chrome.");
}

// تشغيل البوت
require('./bot.js');
