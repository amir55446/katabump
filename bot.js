// ============================================================
//   بوت واتساب - إدارة المجموعات + حماية + يوتيوب
//   WhatsApp Group Manager Bot - Updated Version
// ============================================================

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');
const https = require('https');

// ============================================================
// ⚙️  إعدادات البوت
// ============================================================
const BOT_NUMBER    = '67078736596';   // رقم البوت
const BROKER_NUMBER = '201157784851';  // رقم صاحب الاسكرين (مصر: 01157784851)

const CONFIG = {
  ADMINS: [BOT_NUMBER],
  MAX_WARNINGS: 6,
  AUDIO_DIR: './temp_audio',
  PDF_DIR: './pdfs',
  YOUTUBE_COOLDOWN: 10,
};

// ============================================================
// 💾  إعدادات قابلة للحفظ
// ============================================================
const SETTINGS_FILE = './settings.json';
let botSettings = {
  welcomeEnabled:   true,
  prayerEnabled:    true,
  badWordsEnabled:  true,
  youtubeEnabled:   true,
  botEnabledGroups: {},   // chatId => bool
};

function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      botSettings = Object.assign(botSettings, saved);
    } catch (_) {}
  }
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2));
}

function isBotEnabledInGroup(chatId) {
  if (botSettings.botEnabledGroups[chatId] === false) return false;
  return true;
}

// ============================================================
// 🕌  أوقات الصلاة (الإسكندرية - مصر)
// ============================================================
const CITY    = 'Alexandria';
const COUNTRY = 'Egypt';
let prayerTimers = [];

function fetchPrayerTimes() {
  if (!botSettings.prayerEnabled) return;
  const url = `https://api.aladhan.com/v1/timingsByCity?city=${CITY}&country=${COUNTRY}&method=5`;

  https.get(url, (res) => {
    // ✅ تحقق من كود الاستجابة
    if (res.statusCode !== 200) {
      console.error(`❌ أوقات الصلاة: كود HTTP ${res.statusCode}`);
      res.resume();
      return;
    }

    let data = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      // ✅ تحقق أن البيانات مكتملة قبل parse
      if (!data || data.trim() === '') {
        console.error('❌ أوقات الصلاة: استجابة فارغة');
        return;
      }
      try {
        const json = JSON.parse(data);
        if (!json.data || !json.data.timings) {
          console.error('❌ أوقات الصلاة: بيانات غير صحيحة');
          return;
        }
        schedulePrayerNotifications(json.data.timings);
        console.log('🕌 أوقات الصلاة جاهزة');
      } catch (e) {
        console.error('❌ خطأ أوقات الصلاة:', e.message);
      }
    });
    res.on('error', err => console.error('❌ خطأ قراءة أوقات الصلاة:', err.message));
  }).on('error', err => {
    console.error('❌ فشل جلب أوقات الصلاة:', err.message);
    // إعادة المحاولة بعد دقيقتين
    setTimeout(fetchPrayerTimes, 120000);
  });
}

const PRAYER_NAMES = {
  Fajr:    { name: 'الفجر',   msg: '🌙 صلاة الفجر أثابكم الله\nاستيقظوا للصلاة رحمكم الله 🤲' },
  Dhuhr:   { name: 'الظهر',   msg: '☀️ حان الآن موعد أذان الظهر\nحي على الصلاة 🕌' },
  Asr:     { name: 'العصر',   msg: '🌤️ حان الآن موعد أذان العصر\nحي على الصلاة 🕌' },
  Maghrib: { name: 'المغرب',  msg: '🌅 حان الآن موعد أذان المغرب\nحي على الصلاة 🕌' },
  Isha:    { name: 'العشاء',  msg: '🌙 حان الآن موعد أذان العشاء\nحي على الصلاة 🕌' },
};

function schedulePrayerNotifications(timings) {
  prayerTimers.forEach(t => clearTimeout(t));
  prayerTimers = [];

  const now = new Date();

  Object.entries(PRAYER_NAMES).forEach(([key, info]) => {
    if (!timings[key]) return;
    const parts = timings[key].split(':');
    if (parts.length < 2) return;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return;

    const prayerTime = new Date();
    prayerTime.setHours(h, m, 0, 0);

    const diff = prayerTime - now;
    if (diff > 0) {
      const timer = setTimeout(async () => {
        if (!botSettings.prayerEnabled) return;
        try {
          const chats = await client.getChats();
          for (const chat of chats) {
            if (chat.isGroup && isBotEnabledInGroup(chat.id._serialized)) {
              await chat.sendMessage(info.msg);
            }
          }
          console.log(`🕌 أذان ${info.name}`);
        } catch (e) {
          console.error('❌ خطأ إرسال الأذان:', e.message);
        }
      }, diff);
      prayerTimers.push(timer);
    }
  });

  // تجديد كل يوم الساعة 12:01 ليلاً
  const midnight = new Date();
  midnight.setHours(24, 1, 0, 0);
  setTimeout(fetchPrayerTimes, midnight - now);
}

// ============================================================
// 🔗  فحص الروابط
// ============================================================
function containsLink(text) {
  const linkRegex = /(https?:\/\/|www\.|bit\.ly|t\.me|wa\.me|youtu\.be|tinyurl|linktr\.ee|instagram\.com|facebook\.com|twitter\.com|tiktok\.com|telegram\.me)[^\s]*/i;
  return linkRegex.test(text);
}

// ============================================================
// 🔇  المكتومون وصلاحياتهم
// ============================================================
const mutedUsers  = new Set();
const memberPerms = new Map();
const stickerLocked = new Map();
const imageLocked   = new Map();
const linkLocked    = new Map();

function getPerms(chatId, userId) {
  const key = `${chatId}:${userId}`;
  if (!memberPerms.has(key)) memberPerms.set(key, { sticker: true, media: true, voice: true, text: true });
  return memberPerms.get(key);
}
function isMuted(chatId, userId) { return mutedUsers.has(`${chatId}:${userId}`); }

// ============================================================
// 🖥️  مسار Chrome
// ============================================================
function getChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

// ============================================================
// 🤬  الألفاظ المحظورة
// ============================================================
const BAD_WORDS = [
  'كلب','حمار','غبي','احمق','غليظ','سفيه','وقح','خسيس','حقير','دنيء','وضيع','نذل','جبان','ساقط','فاسد',
  'كس','زب','طيز','عير','نيك','منيك','اتناك','متناك','شرموط','قحبة','عاهر','عاهرة','بغي','ساقطة','مومس',
  'كسمك','كسختك','كسمين','زبي','زبك','ازبي','مص','لحس','بظر','خرم','فتحة',
  'ابن الكلب','بنت الكلب','ابن الشرموطة','بنت الشرموطة','ابن القحبة','بنت القحبة',
  'يلعن امك','لعن امك','امك','ابوك','يلعن ابوك','اختك','يلعن دينك','يخرب بيتك',
  'عرص','خول','معرص','متخول','واطي','حيوان','بهيم','زبالة','قمامة','وسخ','وسخة','قذر','قذرة','نجس',
  'خرا','خره','خراء','براز','تفل','بصاق',
  'fuck','shit','bitch','ass','asshole','bastard','dick','cock','pussy','cunt','whore','slut',
  'motherfucker','damn','hell','piss','screw','retard','idiot',
  'kalb','klab','3ars','3rs','ars','khwal','nik','naik','5ara','khara','kos','kosmak','zob','zeby',
  'sharmoota','a7ba','kahba','k7ba',
  'ك ل ب','ك.ل.ب','ع ر ص','ع.ر.ص','خ و ل','خ.و.ل','ن ي ك','ن.ي.ك','ك س','ك.س','ز ب','ز.ب',
  '🖕',
];

function countBadWords(text) {
  let count = 0;
  const clean = text.toLowerCase().replace(/[\u064B-\u065F]/g, '').replace(/[ـ]/g, '').replace(/\s+/g, ' ');
  for (const w of BAD_WORDS) { if (clean.includes(w.toLowerCase())) count++; }
  const noSp = clean.replace(/[\s._\-]/g, '');
  for (const w of ['كلب','عرص','خول','نيك','كس','زب','شرموط','قحبة','خرا']) { if (noSp.includes(w)) count++; }
  const franco = noSp.replace(/[0-9]/g, '');
  for (const w of ['kalb','ars','khwal','nik','kos','zob','sharmoota']) { if (franco.includes(w)) count++; }
  return count;
}
function containsBadWord(text) { return countBadWords(text) > 0; }

// ============================================================
// 🛡️  حماية من السبام
// ============================================================
const spamTracker = new Map();
const SPAM_LIMIT  = 8;
const SPAM_WINDOW = 5000;

function isSpamming(userId) {
  const now = Date.now();
  const data = spamTracker.get(userId) || { count: 0, lastTime: now };
  if (now - data.lastTime > SPAM_WINDOW) { spamTracker.set(userId, { count: 1, lastTime: now }); return false; }
  data.count++;
  data.lastTime = now;
  spamTracker.set(userId, data);
  return data.count > SPAM_LIMIT;
}

// ============================================================
// 💾  التحذيرات
// ============================================================
const WARNINGS_FILE = './warnings.json';
let warnings = {};

function loadWarnings() {
  if (fs.existsSync(WARNINGS_FILE)) {
    try { warnings = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8')); } catch (_) { warnings = {}; }
  }
}
function saveWarnings() { fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2)); }
function getWarnings(userId) { return warnings[userId] || 0; }
function addWarning(userId) { warnings[userId] = (warnings[userId] || 0) + 1; saveWarnings(); return warnings[userId]; }
function resetWarnings(userId) { delete warnings[userId]; saveWarnings(); }

// ============================================================
// 🎵  تحميل يوتيوب — مع اكتشاف تلقائي لـ yt-dlp
// ============================================================
const youtubeCooldowns = new Map();

// اكتشاف مسار yt-dlp عند تشغيل البوت
function detectYtDlp() {
  const candidates = [
    'yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
  ];
  for (const cmd of candidates) {
    try {
      const { execSync } = require('child_process');
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      console.log(`✅ yt-dlp found: ${cmd}`);
      return { type: 'binary', cmd };
    } catch (_) {}
  }
  // جرب python3 -m yt_dlp
  for (const py of ['python3', 'python']) {
    try {
      const { execSync } = require('child_process');
      execSync(`${py} -m yt_dlp --version`, { stdio: 'pipe' });
      console.log(`✅ yt-dlp found via ${py} module`);
      return { type: 'module', cmd: `${py} -m yt_dlp` };
    } catch (_) {}
  }
  console.warn('⚠️  yt-dlp غير موجود! شغّل: bash setup_ytdlp.sh');
  return null;
}

const YTDLP = detectYtDlp();

function buildYtDlpCommand(ytdlp, safeName, outputTemplate) {
  const base = ytdlp ? ytdlp.cmd : 'yt-dlp';
  return (
    `${base} -x --audio-format mp3 --audio-quality 0 ` +
    `--max-filesize 15m ` +
    `--write-thumbnail --convert-thumbnails jpg ` +
    `--no-playlist ` +
    `--socket-timeout 30 ` +
    `-o "${outputTemplate}" ` +
    `"ytsearch1:${safeName}"`
  );
}

function collectResults(audioDir) {
  if (!fs.existsSync(audioDir)) return { audioPath: null, thumbPath: null };
  const allFiles = fs.readdirSync(audioDir);
  const mp3Files = allFiles.filter(f => f.endsWith('.mp3'));
  if (mp3Files.length === 0) return { audioPath: null, thumbPath: null };
  const latestAudio = mp3Files
    .map(f => ({ name: f, time: fs.statSync(path.join(audioDir, f)).mtime }))
    .sort((a, b) => b.time - a.time)[0];
  const audioPath = path.join(audioDir, latestAudio.name);
  const thumbFiles = allFiles.filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'));
  const latestThumb = thumbFiles.length > 0
    ? thumbFiles.map(f => ({ name: f, time: fs.statSync(path.join(audioDir, f)).mtime })).sort((a, b) => b.time - a.time)[0]
    : null;
  const thumbPath = latestThumb ? path.join(audioDir, latestThumb.name) : null;
  return { audioPath, thumbPath };
}

function downloadYouTubeAudio(songName) {
  return new Promise((resolve, reject) => {
    if (!YTDLP) {
      reject(new Error('yt-dlp غير مثبت على السيرفر.\nشغّل: bash setup_ytdlp.sh'));
      return;
    }
    if (!fs.existsSync(CONFIG.AUDIO_DIR)) fs.mkdirSync(CONFIG.AUDIO_DIR, { recursive: true });

    const safeName = songName.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim();
    const timestamp = Date.now();
    const outputTemplate = path.join(CONFIG.AUDIO_DIR, timestamp + '.%(ext)s');
    const command = buildYtDlpCommand(YTDLP, safeName, outputTemplate);

    console.log(`\n🎵 yt-dlp CMD: ${command}`);

    exec(command, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ yt-dlp stderr:', stderr?.slice(0, 500));
        // لو ffmpeg مش موجود → رسالة واضحة
        if (stderr && stderr.includes('ffmpeg')) {
          reject(new Error('ffmpeg غير مثبت. شغّل: bash setup_ytdlp.sh'));
          return;
        }
        // محاولة تانية بدون thumbnail
        const cmd2 = buildYtDlpCommand(YTDLP, safeName, outputTemplate).replace('--write-thumbnail --convert-thumbnails jpg ', '');
        exec(cmd2, { timeout: 180000 }, (err2, out2, serr2) => {
          if (err2) {
            console.error('❌ yt-dlp retry stderr:', serr2?.slice(0, 300));
            reject(new Error('فشل تحميل الأغنية بعد المحاولتين'));
            return;
          }
          const result = collectResults(CONFIG.AUDIO_DIR);
          if (!result.audioPath) { reject(new Error('لم يتم العثور على ملف MP3')); return; }
          resolve(result);
        });
        return;
      }
      const result = collectResults(CONFIG.AUDIO_DIR);
      if (!result.audioPath) { reject(new Error('لم يتم العثور على ملف MP3 بعد التحميل')); return; }
      resolve(result);
    });
  });
}

// ============================================================
// 📄  البحث عن ملف PDF
// ============================================================
function findPdfFile(filename) {
  const searchDirs = [CONFIG.PDF_DIR, '.', './files', './documents'];
  const cleanName = filename.replace(/\.pdf$/i, '').trim();

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fileBase = file.replace(/\.pdf$/i, '');
        if (fileBase.toLowerCase() === cleanName.toLowerCase() && file.toLowerCase().endsWith('.pdf')) {
          return path.join(dir, file);
        }
      }
      // بحث جزئي لو المطابقة الكاملة مش موجودة
      for (const file of files) {
        if (file.toLowerCase().includes(cleanName.toLowerCase()) && file.toLowerCase().endsWith('.pdf')) {
          return path.join(dir, file);
        }
      }
    } catch (_) {}
  }
  return null;
}

// ============================================================
// 📋  قائمة الجروبات مع حالة الأدمن
// ============================================================
async function getGroupsList() {
  const chats = await client.getChats();
  const botJid = `${BOT_NUMBER}@c.us`;
  const groups = chats.filter(c => c.isGroup);
  return groups.map((g, i) => {
    const participant = g.participants?.find(p => p.id._serialized === botJid);
    const isAdmin = participant ? (participant.isAdmin || participant.isSuperAdmin) : false;
    return { index: i + 1, chat: g, isAdmin };
  });
}

function buildGroupsListText(groups) {
  if (groups.length === 0) return '📭 البوت مش منضم لأي جروب حالياً.';
  let msg = `📋 *قائمة الجروبات (${groups.length})*\n${'─'.repeat(30)}\n`;
  for (const g of groups) {
    const adminMark = g.isAdmin ? '✅' : '❌';
    const enabled   = isBotEnabledInGroup(g.chat.id._serialized) ? '🟢' : '🔴';
    msg += `\n*${g.index}.* ${g.chat.name} ${adminMark} ${enabled}`;
  }
  msg += `\n\n${'─'.repeat(30)}\n✅ = البوت أدمن  |  ❌ = مش أدمن\n🟢 = البوت مفعل  |  🔴 = البوت معطل`;
  return msg;
}

// ============================================================
// 🤖  حالة سير محادثة السمسار (01157784851)
// ============================================================
// phase: 'idle' | 'waiting_name' | 'waiting_group'
const brokerState = {
  phase: 'idle',
  mediaMsg: null,   // رسالة الميديا المحفوظة
  name: '',
  groups: [],
};

// ============================================================
// ⚙️  حالة القائمة في الخاص مع النفس
// ============================================================
// phase: 'idle' | 'waiting_group_name:N' | 'waiting_group_photo:N'
const selfState = { phase: 'idle' };

// ============================================================
// 🤖  إنشاء العميل
// ============================================================
loadWarnings();
loadSettings();

const chromePath = getChromePath();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'group-manager-bot' }),
  puppeteer: {
    headless: true,
    ...(chromePath && { executablePath: chromePath }),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--disable-default-apps',
      '--disable-sync', '--disable-translate', '--no-first-run',
      '--ignore-certificate-errors', '--window-size=800,600',
    ],
    defaultViewport: { width: 800, height: 600 },
    timeout: 0,
    ignoreHTTPSErrors: true,
  },
});

// ============================================================
// 📱  كود الربط
// ============================================================
let pairingCodeRequested = false; // منع التكرار

client.on('qr', async () => {
  // لو طلبنا الكود قبل كدا، متطلبوش تاني
  if (pairingCodeRequested) return;
  pairingCodeRequested = true;

  clearInterval(loadTimer);
  console.clear();

  console.log('════════════════════════════════════════');
  console.log('   🔗 ربط واتساب عن طريق كود الربط');
  console.log(`   📱 الرقم: +${BOT_NUMBER}`);
  console.log('════════════════════════════════════════\n');

  // ✅ انتظر 5 ثواني عشان WhatsApp Web يكمل التحميل
  console.log('⏳ انتظار تحميل WhatsApp Web...');
  await new Promise(r => setTimeout(r, 5000));
  console.log('⏳ جاري طلب كود الربط...\n');

  // ✅ حاول 3 مرات لو فشل
  let code = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      code = await client.requestPairingCode(BOT_NUMBER);
      break; // نجح
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️  محاولة ${attempt}/3 فشلت: ${err.message}`);
      if (attempt < 3) {
        console.log('⏳ إعادة المحاولة بعد 5 ثواني...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  if (!code) {
    console.error('❌ فشل طلب كود الربط بعد 3 محاولات:', lastErr?.message);
    console.log('\n💡 تأكد من:');
    console.log('   • الرقم صح بالصيغة الدولية (بدون +)');
    console.log('   • واتساب مثبت على الهاتف وشغال');
    console.log('   • مش مربوط بجهاز تاني دلوقتي');
    console.log('   • احذف مجلد .wwebjs_auth وأعد التشغيل\n');
    // مش بنعمل process.exit عشان البوت ممكن يحاول تاني
    pairingCodeRequested = false;
    return;
  }

  console.log('════════════════════════════════════════');
  console.log('   ✅ كود الربط الخاص بك:');
  console.log(`\n        🔑  ${code}\n`);
  console.log('════════════════════════════════════════');
  console.log('\n📋 الخطوات:');
  console.log('   1. افتح واتساب على هاتفك');
  console.log('   2. الإعدادات ← الأجهزة المرتبطة');
  console.log('   3. ربط جهاز ← ربط بالرقم بدلاً من الـ QR');
  console.log('   4. أدخل الكود أعلاه\n');
  console.log('⏰ الكود صالح لمدة دقيقتين فقط!\n');
});

// ============================================================
// ✅  جاهز
// ============================================================
client.on('ready', () => {
  clearInterval(loadTimer);
  console.clear();
  console.log('════════════════════════════════════════');
  console.log('   ✅ البوت يعمل الآن!');
  console.log('════════════════════════════════════════');
  console.log(`   🛡️  حماية المجموعات: ${botSettings.badWordsEnabled ? 'مفعّلة' : 'معطلة'}`);
  console.log(`   🎵  يوتيوب: ${botSettings.youtubeEnabled ? 'مفعّل' : 'معطل'}`);
  console.log(`   👋  الترحيب: ${botSettings.welcomeEnabled ? 'مفعّل' : 'معطل'}`);
  console.log(`   🕌  أوقات الصلاة: ${botSettings.prayerEnabled ? 'مفعّلة' : 'معطلة'}`);
  console.log('════════════════════════════════════════');
  setTimeout(fetchPrayerTimes, 2000);
});

// ============================================================
// 👥  رسالة ترحيب — مُصلحة
// ============================================================
client.on('group_join', async (notification) => {
  if (!botSettings.welcomeEnabled) return;
  try {
    const chat = await notification.getChat();
    if (!isBotEnabledInGroup(chat.id._serialized)) return;

    // ✅ الطريقة الصحيحة لجلب العضو الجديد
    let memberName = 'عضو جديد';
    try {
      // recipientIds = مصفوفة الأرقام اللي انضمت
      if (notification.recipientIds && notification.recipientIds.length > 0) {
        const contact = await client.getContactById(notification.recipientIds[0]);
        memberName = contact.pushname || contact.verifiedName || contact.number || 'عضو جديد';
      } else {
        const contact = await notification.getContact();
        memberName = contact.pushname || contact.verifiedName || contact.number || 'عضو جديد';
      }
    } catch (_) {}

    const welcomeMsg =
      `🌟 أهلاً وسهلاً يا *${memberName}* في جروب *${chat.name}* 🎉\n` +
      `يسعدنا انضمامك معنا!\n` +
      `اكتب *!مساعدة* لمعرفة أوامر الجروب 🤖`;

    await chat.sendMessage(welcomeMsg);
    console.log(`✅ ترحيب: ${memberName} في ${chat.name}`);
  } catch (err) {
    console.error('❌ خطأ في الترحيب:', err.message);
  }
});

// ============================================================
// 📨  معالجة الرسائل — موحّدة
// ============================================================
client.on('message_create', async (msg) => {
  try {
    if (msg.isStatus) return;

    const chat = await msg.getChat();

    // ─── خاص ───
    if (!chat.isGroup) {
      await handlePrivateMessage(msg, chat);
      return;
    }

    // ─── جروب ───
    await handleGroupMessage(msg, chat);

  } catch (err) {
    console.error('❌ خطأ في معالجة الرسالة:', err.message);
  }
});

// ============================================================
// 💬  معالجة الرسائل الخاصة
// ============================================================
async function handlePrivateMessage(msg, chat) {
  const sender = await msg.getContact();
  const senderId = sender.id.user;
  const text     = msg.body?.trim() || '';

  // ────────────────────────────────────────────
  // 🤖  خاص مع النفس (إعدادات البوت)
  // ────────────────────────────────────────────
  const isSelfChat = chat.id._serialized === `${BOT_NUMBER}@c.us` && msg.fromMe;
  if (isSelfChat) {
    await handleSelfChat(msg, chat, text);
    return;
  }

  // ────────────────────────────────────────────
  // 🖼️  سمسار (01157784851) يبعت صورة أو اسكرين
  // ────────────────────────────────────────────
  if (senderId === BROKER_NUMBER) {
    await handleBrokerFlow(msg, chat, text, sender);
    return;
  }

  // ────────────────────────────────────────────
  // 🚫  أي شخص تاني يبعت خاص → رد تلقائي
  // ────────────────────────────────────────────
  if (!msg.fromMe) {
    await msg.reply(
      `🤖 لا يمكنك التواصل معي لأنني روبوت\n` +
      `تواصل مع مطوري وهو *أمير* 👨‍💻`
    );
  }
}

// ============================================================
// ⚙️  إعدادات البوت (خاص مع النفس)
// ============================================================
async function handleSelfChat(msg, chat, text) {

  // ── انتظار اسم جروب ──
  if (selfState.phase.startsWith('waiting_group_name:')) {
    const idx = parseInt(selfState.phase.split(':')[1], 10);
    selfState.phase = 'idle';
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await msg.reply('❌ رقم الجروب مش صح.'); return; }
      await target.chat.setSubject(text);
      await msg.reply(`✅ تم تغيير اسم *${target.chat.name}* إلى *${text}*`);
    } catch (err) {
      await msg.reply('❌ فشل تغيير الاسم: ' + err.message);
    }
    return;
  }

  // ── انتظار صورة جروب ──
  if (selfState.phase.startsWith('waiting_group_photo:')) {
    const idx = parseInt(selfState.phase.split(':')[1], 10);
    if (!msg.hasMedia) { await msg.reply('❌ ابعت صورة مش نص.'); return; }
    selfState.phase = 'idle';
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await msg.reply('❌ رقم الجروب مش صح.'); return; }
      const media = await msg.downloadMedia();
      await target.chat.setPicture(media);
      await msg.reply(`✅ تم تغيير صورة جروب *${target.chat.name}*`);
    } catch (err) {
      await msg.reply('❌ فشل تغيير الصورة: ' + err.message);
    }
    return;
  }

  // ══════════════════════════════════════════
  // الأوامر المباشرة
  // ══════════════════════════════════════════

  if (text === 'اعدادات البوت' || text === 'إعدادات البوت') {
    const menu =
      `⚙️ *إعدادات البوت*\n${'═'.repeat(30)}\n\n` +
      `1️⃣  الترحيب: ${botSettings.welcomeEnabled ? '✅ مفعّل' : '❌ معطّل'}\n` +
      `    → اكتب: *تفعيل الترحيب* / *تعطيل الترحيب*\n\n` +
      `2️⃣  أوقات الصلاة: ${botSettings.prayerEnabled ? '✅ مفعّلة' : '❌ معطّلة'}\n` +
      `    → اكتب: *تفعيل الصلاة* / *تعطيل الصلاة*\n\n` +
      `3️⃣  فلتر الشتائم: ${botSettings.badWordsEnabled ? '✅ مفعّل' : '❌ معطّل'}\n` +
      `    → اكتب: *تفعيل الحماية* / *تعطيل الحماية*\n\n` +
      `4️⃣  يوتيوب: ${botSettings.youtubeEnabled ? '✅ مفعّل' : '❌ معطّل'}\n` +
      `    → اكتب: *تفعيل اليوتيوب* / *تعطيل اليوتيوب*\n\n` +
      `${'─'.repeat(30)}\n` +
      `📋 *أوامر إدارة الجروبات:*\n` +
      `• *قائمة الجروبات* — عرض كل الجروبات\n` +
      `• *تفعيل البوت [رقم]* — تفعيل في جروب\n` +
      `• *تعطيل البوت [رقم]* — تعطيل في جروب\n` +
      `• *تغيير اسم [رقم]* — تغيير اسم جروب\n` +
      `• *تغيير صورة [رقم]* — تغيير صورة جروب\n\n` +
      `📖 *اوامر البوت* — لعرض كل الأوامر`;
    await msg.reply(menu);
    return;
  }

  if (text === 'اوامر البوت' || text === 'أوامر البوت') {
    const cmds =
      `📖 *قائمة أوامر البوت*\n${'═'.repeat(30)}\n\n` +
      `*🎵 للجميع:*\n` +
      `يوت [اسم الأغنية] — تحميل أغنية\n` +
      `.[اسم الملف] — البحث عن PDF\n\n` +
      `*👮 للمشرفين (في الجروب):*\n` +
      `قفل/فتح الملصقات\n` +
      `قفل/فتح الصور\n` +
      `قفل/فتح الروابط\n` +
      `اقفل المكالمة\n` +
      `كتم / رفع الكتم — رد على رسالة\n` +
      `مسح / احذف — رد على رسالة\n` +
      `حظر / بان — رد على رسالة\n` +
      `حظر [رقم] — حظر برقم\n` +
      `!حظر @شخص — حظر بذكر\n` +
      `!طرد @شخص — طرد عضو\n` +
      `!تحذير @شخص — تحذير\n` +
      `!مسح @شخص — مسح تحذيرات\n` +
      `اضافة [رقم] — إضافة عضو\n` +
      `مسح كل الرسايل — رد على رسالة عضو\n` +
      `!معلومات — معلومات الجروب\n` +
      `قائمة الصلاحيات — عرض الصلاحيات\n` +
      `سلب/منح صلاحية ملصقات/وسائط/صوت/رسائل\n\n` +
      `*🤖 للبوت (خاص مع نفسك):*\n` +
      `اعدادات البوت — إعدادات كاملة\n` +
      `قائمة الجروبات — عرض الجروبات\n` +
      `اوامر البوت — هذه القائمة`;
    await msg.reply(cmds);
    return;
  }

  // ─ تبديل الترحيب ─
  if (text === 'تفعيل الترحيب') {
    botSettings.welcomeEnabled = true; saveSettings();
    await msg.reply('✅ تم تفعيل الترحيب في جميع الجروبات');
    return;
  }
  if (text === 'تعطيل الترحيب') {
    botSettings.welcomeEnabled = false; saveSettings();
    await msg.reply('❌ تم تعطيل الترحيب في جميع الجروبات');
    return;
  }

  // ─ تبديل الصلاة ─
  if (text === 'تفعيل الصلاة') {
    botSettings.prayerEnabled = true; saveSettings();
    fetchPrayerTimes();
    await msg.reply('✅ تم تفعيل إشعارات أوقات الصلاة');
    return;
  }
  if (text === 'تعطيل الصلاة') {
    botSettings.prayerEnabled = false; saveSettings();
    prayerTimers.forEach(t => clearTimeout(t)); prayerTimers = [];
    await msg.reply('❌ تم تعطيل إشعارات أوقات الصلاة');
    return;
  }

  // ─ تبديل الحماية ─
  if (text === 'تفعيل الحماية') {
    botSettings.badWordsEnabled = true; saveSettings();
    await msg.reply('✅ تم تفعيل فلتر الشتائم والحماية');
    return;
  }
  if (text === 'تعطيل الحماية') {
    botSettings.badWordsEnabled = false; saveSettings();
    await msg.reply('❌ تم تعطيل فلتر الشتائم والحماية');
    return;
  }

  // ─ تبديل يوتيوب ─
  if (text === 'تفعيل اليوتيوب') {
    botSettings.youtubeEnabled = true; saveSettings();
    await msg.reply('✅ تم تفعيل تحميل اليوتيوب');
    return;
  }
  if (text === 'تعطيل اليوتيوب') {
    botSettings.youtubeEnabled = false; saveSettings();
    await msg.reply('❌ تم تعطيل تحميل اليوتيوب');
    return;
  }

  // ─ قائمة الجروبات ─
  if (text === 'قائمة الجروبات') {
    try {
      const groups = await getGroupsList();
      await msg.reply(buildGroupsListText(groups));
    } catch (err) {
      await msg.reply('❌ فشل جلب الجروبات: ' + err.message);
    }
    return;
  }

  // ─ تفعيل/تعطيل البوت في جروب ─
  const enableMatch  = text.match(/^تفعيل البوت (\d+)$/);
  const disableMatch = text.match(/^تعطيل البوت (\d+)$/);
  if (enableMatch || disableMatch) {
    const idx    = parseInt((enableMatch || disableMatch)[1], 10);
    const enable = !!enableMatch;
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await msg.reply('❌ رقم الجروب مش صح.'); return; }
      botSettings.botEnabledGroups[target.chat.id._serialized] = enable;
      saveSettings();
      await msg.reply(`${enable ? '✅ تفعيل' : '❌ تعطيل'} البوت في جروب *${target.chat.name}*`);
    } catch (err) {
      await msg.reply('❌ خطأ: ' + err.message);
    }
    return;
  }

  // ─ تغيير اسم جروب ─
  const renameMatch = text.match(/^تغيير اسم (\d+)$/);
  if (renameMatch) {
    const idx = parseInt(renameMatch[1], 10);
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await msg.reply('❌ رقم الجروب مش صح.'); return; }
      selfState.phase = `waiting_group_name:${idx}`;
      await msg.reply(`✏️ اكتب الاسم الجديد لجروب *${target.chat.name}*:`);
    } catch (err) {
      await msg.reply('❌ خطأ: ' + err.message);
    }
    return;
  }

  // ─ تغيير صورة جروب ─
  const photoMatch = text.match(/^تغيير صورة (\d+)$/);
  if (photoMatch) {
    const idx = parseInt(photoMatch[1], 10);
    try {
      const groups = await getGroupsList();
      const target = groups.find(g => g.index === idx);
      if (!target) { await msg.reply('❌ رقم الجروب مش صح.'); return; }
      selfState.phase = `waiting_group_photo:${idx}`;
      await msg.reply(`📷 ابعت الصورة الجديدة لجروب *${target.chat.name}*:`);
    } catch (err) {
      await msg.reply('❌ خطأ: ' + err.message);
    }
    return;
  }
}

// ============================================================
// 🖼️  تدفق سير سمسار (01157784851)
// ============================================================
async function handleBrokerFlow(msg, chat, text, sender) {

  // ── مرحلة: استقبال صورة / اسكرين (تبدأ الرحلة) ──
  if (msg.hasMedia && (msg.type === 'image' || msg.type === 'document' || msg.type === 'video')) {
    brokerState.phase    = 'waiting_name';
    brokerState.mediaMsg = msg;
    brokerState.name     = '';
    brokerState.groups   = [];
    await msg.reply(
      `✅ وصلت الصورة!\n\n` +
      `❓ *السؤال الأول:*\nإيه اسم المشروع أو الشخص اللي هيتبعتله؟`
    );
    return;
  }

  // ── مرحلة: انتظار الاسم ──
  if (brokerState.phase === 'waiting_name') {
    if (!text) { await msg.reply('❌ اكتب الاسم كنص.'); return; }
    brokerState.name  = text;
    brokerState.phase = 'waiting_group';

    try {
      const groups = await getGroupsList();
      brokerState.groups = groups;
      let listMsg =
        `👤 الاسم: *${text}*\n\n` +
        `📋 *اختار الجروب اللي هيتبعتله:*\n${'─'.repeat(25)}\n`;
      for (const g of groups) {
        const mark = g.isAdmin ? '✅' : '❌';
        listMsg += `\n*${g.index}.* ${mark} ${g.chat.name}`;
      }
      listMsg += `\n\n${'─'.repeat(25)}\n✅ البوت أدمن  |  ❌ مش أدمن\n\nاكتب رقم الجروب:`;
      await msg.reply(listMsg);
    } catch (err) {
      await msg.reply('❌ فشل جلب الجروبات: ' + err.message);
      brokerState.phase = 'idle';
    }
    return;
  }

  // ── مرحلة: انتظار اختيار الجروب ──
  if (brokerState.phase === 'waiting_group') {
    const choice = parseInt(text, 10);
    if (isNaN(choice)) { await msg.reply('❌ اكتب رقم الجروب فقط.'); return; }

    const target = brokerState.groups.find(g => g.index === choice);
    if (!target) {
      await msg.reply(`❌ رقم مش صح. اختار من 1 إلى ${brokerState.groups.length}`);
      return;
    }

    if (!target.isAdmin) {
      await msg.reply(`⚠️ البوت مش أدمن في *${target.chat.name}*، ممكن ما يقدرش يبعت.\nهتكمل؟ اكتب *نعم* أو اختار رقم تاني.`);
    }

    try {
      const caption =
        `𝔻𝕆ℕ𝔼 BY: 𝑻𝑬𝑺𝑳𝑨 𝑻𝑬𝑨𝑴\n+${brokerState.name}`;

      const media = await brokerState.mediaMsg.downloadMedia();
      await target.chat.sendMessage(media, { caption });

      await msg.reply(`✅ تم إرسال الصورة مع الرسالة إلى *${target.chat.name}* بنجاح! 🚀`);
      console.log(`📤 السمسار أرسل إلى: ${target.chat.name}`);
    } catch (err) {
      await msg.reply('❌ فشل الإرسال: ' + err.message);
    }

    brokerState.phase    = 'idle';
    brokerState.mediaMsg = null;
    brokerState.name     = '';
    brokerState.groups   = [];
    return;
  }

  // ── أي رسالة نصية وقت idle → رد عادي ──
  if (!msg.fromMe && brokerState.phase === 'idle' && !msg.hasMedia) {
    await msg.reply(
      `👋 مرحباً!\nابعت الصورة أو الاسكرين اللي عايز تبعتها للجروب وأنا هساعدك.`
    );
  }
}

// ============================================================
// 💬  معالجة رسائل الجروبات
// ============================================================
async function handleGroupMessage(msg, chat) {
  if (!isBotEnabledInGroup(chat.id._serialized)) return;

  const sender     = await msg.getContact();
  const senderId   = sender.id.user;
  const senderName = sender.pushname || sender.number;
  const text       = msg.body?.trim() || '';

  const participants   = chat.participants || [];
  const participantObj = participants.find(p => p.id.user === senderId);
  const isGroupAdmin   = participantObj ? (participantObj.isAdmin || participantObj.isSuperAdmin) : false;
  const isAdmin        = CONFIG.ADMINS.includes(senderId) || isGroupAdmin;

  console.log(`\n📩 [${chat.name}] ${senderName}: ${text.substring(0, 50)}`);

  // ════════════════════════════════════════════════════
  // 📄  البحث عن PDF بأمر .اسم_الملف
  // ════════════════════════════════════════════════════
  if (text.startsWith('.') && text.length > 1 && !text.startsWith('. ')) {
    const filename = text.slice(1).trim();
    const pdfPath  = findPdfFile(filename);
    if (pdfPath) {
      try {
        const media = MessageMedia.fromFilePath(pdfPath);
        await msg.reply(media, undefined, { caption: `📄 *${path.basename(pdfPath)}*` });
        console.log(`📄 إرسال PDF: ${pdfPath}`);
      } catch (err) {
        await msg.reply('❌ وُجد الملف لكن فشل إرساله: ' + err.message);
      }
    } else {
      await msg.reply(
        `❌ مش لاقي ملف PDF باسم *${filename}*\n` +
        `تأكد من الاسم أو حط الملف في مجلد /pdfs`
      );
    }
    return;
  }

  // ════════════════════════════════════════════════════
  // 👤  فين امير؟
  // ════════════════════════════════════════════════════
  if (
    text.includes('فين امير') || text.includes('امير فين') ||
    text.includes('فين أمير') || text.includes('أمير فين') ||
    text === 'امير' || text === 'أمير'
  ) {
    await msg.reply('معلش 😅 امير مش موجود دلوقتي\nممكن يكون موجود لما يفضى عشان عنده مزاكرة وحاجات مهمة 📚');
    return;
  }

  // ════════════════════════════════════════════════════
  // 🎵  يوتيوب
  // ════════════════════════════════════════════════════
  const youtubeMatch = text.match(/^يوت\s+(.+)/i) || text.match(/^يوتيوب\s+(.+)/i);
  if (youtubeMatch && botSettings.youtubeEnabled) {
    const songName = youtubeMatch[1].trim();
    const lastRequest = youtubeCooldowns.get(senderId);
    if (lastRequest && Date.now() - lastRequest < CONFIG.YOUTUBE_COOLDOWN * 1000) {
      await msg.reply(`⏳ انتظر ${CONFIG.YOUTUBE_COOLDOWN} ثانية!`);
      return;
    }
    youtubeCooldowns.set(senderId, Date.now());
    const waitMsg = await msg.reply(`🔍 جاري البحث عن: *${songName}*\nانتظر...`);
    try {
      const { audioPath, thumbPath } = await downloadYouTubeAudio(songName);
      if (thumbPath && fs.existsSync(thumbPath)) {
        const thumbMedia = MessageMedia.fromFilePath(thumbPath);
        await msg.reply(thumbMedia, undefined, { caption: `🎵 *${songName}*` });
        fs.unlink(thumbPath, () => {});
      }
      const audioMedia = MessageMedia.fromFilePath(audioPath);
      audioMedia.mimetype = 'audio/mpeg';
      await msg.reply(audioMedia, undefined, { sendAudioAsVoice: false });
      fs.unlink(audioPath, (err) => { if (!err) console.log(`🗑️ تم مسح: ${audioPath}`); });
      try { await waitMsg.delete(true); } catch (_) {}
      console.log(`✅ أغنية: ${songName}`);
    } catch (err) {
      await msg.reply('❌ فشل التحميل. تأكد من اسم الأغنية أو تثبيت yt-dlp.');
    }
    return;
  }

  // ════════════════════════════════════════════════════
  // 🔒  قفل الملصقات/الصور/الوسائط/الصوت/الروابط + كتم
  // ════════════════════════════════════════════════════
  if (!isAdmin) {
    const chatKey = chat.id._serialized;
    const perms   = getPerms(chatKey, senderId);

    if (isMuted(chatKey, senderId)) { try { await msg.delete(true); } catch (_) {} return; }
    if (msg.type === 'chat' && !perms.text) { try { await msg.delete(true); } catch (_) {} return; }
    if (msg.type === 'sticker' && (!perms.sticker || stickerLocked.get(chatKey))) { try { await msg.delete(true); } catch (_) {} return; }
    if ((msg.type === 'image' || msg.type === 'video' || msg.type === 'document') && (!perms.media || imageLocked.get(chatKey))) { try { await msg.delete(true); } catch (_) {} return; }
    if ((msg.type === 'ptt' || msg.type === 'audio') && !perms.voice) { try { await msg.delete(true); } catch (_) {} return; }
    if (linkLocked.get(chatKey) && msg.type === 'chat' && containsLink(text)) {
      try {
        await msg.delete(true);
        await chat.sendMessage(`مش قولنا ممنوع الروابط؟ 🙂\nممنوع اللينكات متبعتهاش تاني ❤`, { mentions: [sender] });
        console.log(`🔗 رابط حُذف من: ${senderName}`);
      } catch (_) {}
      return;
    }
  }

  // ════════════════════════════════════════════════════
  // 🛡️  سبام + شتائم
  // ════════════════════════════════════════════════════
  if (!isAdmin && isSpamming(senderId)) {
    try { await msg.delete(true); console.log(`⚡ سبام من: ${senderName}`); } catch (_) {}
    return;
  }

  if (!isAdmin && botSettings.badWordsEnabled && text.length > 0) {
    const badCount = countBadWords(text);
    if (badCount > 0) {
      try {
        await msg.delete(true);
        if (badCount > 6) {
          await chat.removeParticipants([sender.id._serialized]);
          resetWarnings(senderId);
          await chat.sendMessage(`🚫 تم حظر *${senderName}* فوراً بسبب رسالة تحتوي على ${badCount} شتيمة.`, { mentions: [sender] });
        } else {
          const warnCount = addWarning(senderId);
          if (warnCount >= CONFIG.MAX_WARNINGS) {
            await chat.removeParticipants([sender.id._serialized]);
            resetWarnings(senderId);
            await chat.sendMessage(`🚫 تم حظر *${senderName}* بسبب الشتائم المتكررة.`, { mentions: [sender] });
          } else {
            await chat.sendMessage(`⚠️ تحذير *${senderName}*!\nاستخدمت ألفاظ غير لائقة.\nالتحذيرات: ${warnCount}/${CONFIG.MAX_WARNINGS}`, { mentions: [sender] });
          }
        }
      } catch (err) { console.error('❌ خطأ في الحظر/التحذير:', err.message); }
      return;
    }
  }

  // ════════════════════════════════════════════════════
  // 👮  للجميع
  // ════════════════════════════════════════════════════
  if (
    text.includes('مين صاحب الروم') || text.includes('مين صاحب الجروب') ||
    text.includes('صاحب الروم مين') || text.includes('صاحب الجروب مين')
  ) {
    await chat.sendMessage('👑 *AMIR* هو صاحب الروم');
    return;
  }

  if (text === '!مساعدة' || text === '!help') {
    const helpMsg =
      `🤖 *أوامر البوت*\n\n` +
      `*📄 للجميع:*\n` +
      `.[اسم الملف] — البحث عن PDF\n` +
      `يوت [اغنية] — تحميل أغنية\n\n` +
      `*👮 للمشرفين:*\n` +
      `قفل/فتح الملصقات | قفل/فتح الصور\n` +
      `قفل/فتح الروابط | اقفل المكالمة\n` +
      `مسح / احذف — رد على رسالة\n` +
      `حظر / بان — رد على رسالة\n` +
      `حظر [رقم] — حظر بالرقم\n` +
      `!حظر @شخص | !طرد @شخص\n` +
      `!تحذير @شخص | !مسح @شخص\n` +
      `اضافة [رقم] — إضافة عضو\n` +
      `مسح كل الرسايل — رد على رسالة\n` +
      `!معلومات — معلومات الجروب\n` +
      `قائمة الصلاحيات`;
    await msg.reply(helpMsg);
    return;
  }

  if (!isAdmin) return;

  // ════════════════════════════════════════════════════
  // 👮  أوامر المشرفين فقط
  // ════════════════════════════════════════════════════

  if (text === 'كتم') {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    mutedUsers.add(`${chat.id._serialized}:${target.id.user}`);
    await chat.sendMessage(`🔇 تم كتم *${target.pushname || target.number}*`, { mentions: [target] });
    return;
  }

  if (text === 'رفع الكتم' || text === 'فك الكتم') {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    mutedUsers.delete(`${chat.id._serialized}:${target.id.user}`);
    await chat.sendMessage(`🔊 تم رفع الكتم عن *${target.pushname || target.number}*`, { mentions: [target] });
    return;
  }

  if (text === 'قائمة الصلاحيات' || text === 'الصلاحيات') {
    const parts = chat.participants || [];
    let listMsg = `📋 *قائمة الصلاحيات — ${chat.name}*\n${'─'.repeat(30)}\n`;
    let idx = 1;
    for (const p of parts) {
      const uid = p.id.user;
      const role = (p.isAdmin || p.isSuperAdmin) ? '👑 أدمن' : '👤 عضو';
      const muted = mutedUsers.has(`${chat.id._serialized}:${uid}`) ? '🔇 ' : '';
      const perms = getPerms(chat.id._serialized, uid);
      listMsg += `\n*${idx}.* +${uid} ${role} ${muted}\n`;
      listMsg += `   💬${perms.text?'✅':'❌'} 🖼️${perms.media?'✅':'❌'} 🎤${perms.voice?'✅':'❌'} 😀${perms.sticker?'✅':'❌'}\n`;
      idx++;
    }
    listMsg += `\n${'─'.repeat(30)}\nرد على رسالة العضو واكتب:\n*سلب/منح صلاحية ملصقات/وسائط/صوت/رسائل*`;
    await chat.sendMessage(listMsg);
    return;
  }

  const permActions = {
    'سلب صلاحية ملصقات': { perm: 'sticker', val: false }, 'منح صلاحية ملصقات': { perm: 'sticker', val: true },
    'سلب صلاحية وسائط':  { perm: 'media',   val: false }, 'منح صلاحية وسائط':  { perm: 'media',   val: true },
    'سلب صلاحية صور':    { perm: 'media',   val: false }, 'منح صلاحية صور':    { perm: 'media',   val: true },
    'سلب صلاحية صوت':    { perm: 'voice',   val: false }, 'منح صلاحية صوت':    { perm: 'voice',   val: true },
    'سلب صلاحية رسائل':  { perm: 'text',    val: false }, 'منح صلاحية رسائل':  { perm: 'text',    val: true },
  };

  if (permActions[text]) {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    const { perm, val } = permActions[text];
    const perms = getPerms(chat.id._serialized, target.id.user);
    perms[perm] = val;
    const permNames = { sticker: 'الملصقات', media: 'الوسائط/الصور', voice: 'التسجيلات الصوتية', text: 'الرسائل' };
    await chat.sendMessage(`${val ? '✅ منح' : '❌ سلب'} صلاحية *${permNames[perm]}* ${val ? 'لـ' : 'من'} *${target.pushname || target.number}*`, { mentions: [target] });
    return;
  }

  if (text === 'قفل الروابط' || text === 'منع الروابط') { linkLocked.set(chat.id._serialized, true); await chat.sendMessage('🔒 تم قفل الروابط'); return; }
  if (text === 'فتح الروابط' || text === 'سماح الروابط') { linkLocked.set(chat.id._serialized, false); await chat.sendMessage('🔓 تم فتح الروابط'); return; }
  if (text === 'قفل الملصقات') { stickerLocked.set(chat.id._serialized, true); await chat.sendMessage('🔒 تم قفل الملصقات'); return; }
  if (text === 'فتح الملصقات') { stickerLocked.set(chat.id._serialized, false); await chat.sendMessage('🔓 تم فتح الملصقات'); return; }
  if (text === 'قفل الصور') { imageLocked.set(chat.id._serialized, true); await chat.sendMessage('🔒 تم قفل الصور'); return; }
  if (text === 'فتح الصور') { imageLocked.set(chat.id._serialized, false); await chat.sendMessage('🔓 تم فتح الصور'); return; }

  if (text === 'اقفل المكالمه' || text === 'اقفل المكالمة' || text === 'اقفل المكالمه الجماعيه') {
    try { await chat.setMessagesAdminsOnly(true); await chat.sendMessage('📵 تم قفل المكالمات الجماعية'); }
    catch (_) { await msg.reply('❌ فشل قفل المكالمة.'); }
    return;
  }

  if (text === 'مسح كل الرسايل' || text === 'مسح كل رسايله') {
    if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو.'); return; }
    const q = await msg.getQuotedMessage(); const target = await q.getContact();
    await msg.reply(`🗑️ جاري مسح رسايل *${target.pushname || target.number}*...`);
    try {
      const messages = await chat.fetchMessages({ limit: 1000 });
      let count = 0;
      for (const m of messages) {
        if (m.author === target.id._serialized || m.from === target.id._serialized) {
          try { await m.delete(true); count++; await new Promise(r => setTimeout(r, 300)); } catch (_) {}
        }
      }
      await chat.sendMessage(`✅ تم مسح ${count} رسالة لـ *${target.pushname || target.number}*`);
    } catch (err) { await msg.reply('❌ فشل مسح الرسايل: ' + err.message); }
    return;
  }

  if (text === 'مسح' || text === 'احذف') {
    if (msg.hasQuotedMsg) { const q = await msg.getQuotedMessage(); await q.delete(true); await msg.react('✅'); }
    else { await msg.reply('❌ اعمل رد على الرسالة اللي تريد تحذفها.'); }
    return;
  }

  if (text === 'حظر' || text === 'بان') {
    if (msg.hasQuotedMsg) {
      const q = await msg.getQuotedMessage(); const target = await q.getContact();
      await chat.removeParticipants([target.id._serialized]);
      await chat.sendMessage(`🚫 تم حظر *${target.pushname || target.number}*`, { mentions: [target] });
    } else { await msg.reply('❌ اعمل رد على رسالة الشخص اللي تريد تحظره.'); }
    return;
  }

  if (text.startsWith('حظر ') || text.startsWith('بان ')) {
    let number = text.split(' ')[1]?.replace(/[^0-9]/g, '');
    if (!number) { await msg.reply('❌ اكتب الرقم صح: حظر 201XXXXXXXXX'); return; }
    if (number.startsWith('0')) number = '2' + number;
    try {
      await chat.removeParticipants([`${number}@c.us`]);
      await chat.sendMessage(`🚫 تم حظر +${number} من الجروب`);
    } catch (err) { await msg.reply('❌ فشل الحظر. تأكد إن الرقم موجود.'); }
    return;
  }

  if (text.startsWith('!حظر') || text.startsWith('!ban')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !حظر @شخص'); return; }
    for (const c of mentioned) {
      await chat.removeParticipants([c.id._serialized]);
      await chat.sendMessage(`🚫 تم حظر *${c.pushname || c.number}*`, { mentions: [c] });
    }
    return;
  }

  if (text.startsWith('!طرد') || text.startsWith('!kick')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !طرد @شخص'); return; }
    for (const c of mentioned) {
      await chat.removeParticipants([c.id._serialized]);
      await chat.sendMessage(`👢 تم طرد *${c.pushname || c.number}*`, { mentions: [c] });
    }
    return;
  }

  if (text.startsWith('!تحذير') || text.startsWith('!warn')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !تحذير @شخص'); return; }
    for (const c of mentioned) {
      const count = addWarning(c.id.user);
      await chat.sendMessage(`⚠️ تحذير *${c.pushname || c.number}*\nالتحذيرات: ${count}/${CONFIG.MAX_WARNINGS}`, { mentions: [c] });
    }
    return;
  }

  if (text.startsWith('!مسح') || text.startsWith('!reset')) {
    const mentioned = await msg.getMentions();
    if (!mentioned.length) { await msg.reply('❌ اذكر الشخص: !مسح @شخص'); return; }
    for (const c of mentioned) { resetWarnings(c.id.user); await msg.reply(`✅ تم مسح تحذيرات @${c.id.user}`); }
    return;
  }

  if (text === '!معلومات' || text === '!info') {
    const parts = chat.participants || [];
    const admins = parts.filter(p => p.isAdmin || p.isSuperAdmin).length;
    await msg.reply(`📋 *معلومات المجموعة*\n\n• الاسم: ${chat.name}\n• الأعضاء: ${parts.length}\n• المشرفون: ${admins}`);
    return;
  }

  if (text.startsWith('اضافة') || text.startsWith('add')) {
    let number = text.split(' ')[1]?.trim().replace(/[^0-9]/g, '');
    if (!number) { await msg.reply('❌ اكتب الرقم: اضافة 201XXXXXXXXX'); return; }
    if (number.startsWith('0')) number = '2' + number;
    try {
      await chat.addParticipants([`${number}@c.us`]);
      await chat.sendMessage(`✅ تمت إضافة +${number} للجروب 🎉`);
    } catch (err) { await msg.reply('❌ فشل إضافة الرقم. تأكد إن الرقم صح وعنده واتساب.'); }
    return;
  }
}

// ============================================================
// 🔌  معالجة الأخطاء
// ============================================================
client.on('disconnected', (reason) => {
  console.log('⚠️ انقطع الاتصال:', reason);
  console.log('🔄 إعادة الاتصال خلال 10 ثوانٍ...');
  setTimeout(() => {
    client.initialize().catch(err => console.error('❌ فشل إعادة الاتصال:', err.message));
  }, 10000);
});

client.on('auth_failure', (msg) => {
  console.error('❌ فشل التوثيق:', msg);
  console.log('💡 احذف مجلد .wwebjs_auth وأعد التشغيل.');
});

// ============================================================
// 🚀  تشغيل
// ============================================================
console.log('════════════════════════════════════════');
console.log('   بوت واتساب — جاري التشغيل...');
console.log('════════════════════════════════════════\n');

const loadMsgs = ['⏳ فتح Chrome...', '🌐 الاتصال بواتساب...', '🔄 تحميل الجلسة...', '📡 مزامنة...'];
let li = 0, ld = 0;
const loadTimer = setInterval(() => {
  ld = (ld + 1) % 4;
  process.stdout.write(`\r${loadMsgs[li]}${ '.'.repeat(ld + 1) }   `);
  if (ld === 3) li = (li + 1) % loadMsgs.length;
}, 600);

client.initialize().catch(err => {
  console.error('❌ فشل تشغيل البوت:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 إيقاف البوت...');
  if (fs.existsSync(CONFIG.AUDIO_DIR)) {
    fs.readdirSync(CONFIG.AUDIO_DIR).forEach(f => {
      try { fs.unlinkSync(path.join(CONFIG.AUDIO_DIR, f)); } catch (_) {}
    });
  }
  process.exit(0);
});
