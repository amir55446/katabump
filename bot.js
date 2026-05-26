// ============================================================
//   بوت واتساب - إدارة المجموعات + حماية + يوتيوب
//   WhatsApp Group Manager Bot - Fixed Version
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
const CONFIG = {
  ADMINS: ['67078736596 '], // أرقام المشرفين الرئيسيين
  MAX_WARNINGS: 6,
  AUDIO_DIR: './temp_audio',
  YOUTUBE_COOLDOWN: 10,
};

// ============================================================
// 🕌  أوقات الصلاة (الإسكندرية - مصر)
// ============================================================
const CITY    = 'Alexandria';
const COUNTRY = 'Egypt';
let prayerTimers = [];

function fetchPrayerTimes() {
  const url = `https://api.aladhan.com/v1/timingsByCity?city=${CITY}&country=${COUNTRY}&method=5`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const timings = json.data.timings;
        schedulePrayerNotifications(timings);
        console.log('🕌 أوقات الصلاة جاهزة');
      } catch (e) {
        console.error('❌ خطأ أوقات الصلاة:', e.message);
      }
    });
  }).on('error', err => console.error('❌ فشل جلب أوقات الصلاة:', err.message));
}

const PRAYER_NAMES = {
  Fajr:    { name: 'الفجر',   msg: '🌙 صلاة الفجر أثابكم الله\nاستيقظوا للصلاة رحمكم الله 🤲' },
  Dhuhr:   { name: 'الظهر',   msg: '☀️ حان الآن موعد أذان الظهر\nحي على الصلاة 🕌' },
  Asr:     { name: 'العصر',   msg: '🌤️ حان الآن موعد أذان العصر\nحي على الصلاة 🕌' },
  Maghrib: { name: 'المغرب',  msg: '🌅 حان الآن موعد أذان المغرب\nحي على الصلاة 🕌' },
  Isha:    { name: 'العشاء',  msg: '🌙 حان الآن موعد أذان العشاء\nحي على الصلاة 🕌' },
};

function schedulePrayerNotifications(timings) {
  // امسح التايمرات القديمة
  prayerTimers.forEach(t => clearTimeout(t));
  prayerTimers = [];

  const now = new Date();

  Object.entries(PRAYER_NAMES).forEach(([key, info]) => {
    const [h, m] = timings[key].split(':').map(Number);
    const prayerTime = new Date();
    prayerTime.setHours(h, m, 0, 0);

    const diff = prayerTime - now;
    if (diff > 0) {
      const timer = setTimeout(async () => {
        try {
          const chats = await client.getChats();
          for (const chat of chats) {
            if (chat.isGroup) {
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

  // جدد أوقات الصلاة كل يوم الساعة 12 الليل
  const midnight = new Date();
  midnight.setHours(24, 1, 0, 0);
  const tillMidnight = midnight - now;
  setTimeout(fetchPrayerTimes, tillMidnight);
}


const stickerLocked = new Map();
const imageLocked   = new Map();
const linkLocked    = new Map(); // chatId => true/false

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
const mutedUsers  = new Set(); // "chatId:userId"
const memberPerms = new Map(); // "chatId:userId" => { sticker, media, voice, text }

function getPerms(chatId, userId) {
  const key = `${chatId}:${userId}`;
  if (!memberPerms.has(key)) memberPerms.set(key, { sticker: true, media: true, voice: true, text: true });
  return memberPerms.get(key);
}
function isMuted(chatId, userId) { return mutedUsers.has(`${chatId}:${userId}`); }


function getChromePath() {
  // لو السيرفر حدد المسار في متغير البيئة (Dockerfile)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log(`✅ Chrome (env): ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const possiblePaths = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    // Linux / Server
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      console.log(`✅ Chrome found: ${p}`);
      return p;
    }
  }

  console.warn('⚠️ لم يتم العثور على Chrome تلقائياً. تأكد من تثبيته.');
  return null;
}

// ============================================================
// 🤬  قائمة الألفاظ المحظورة الشاملة
// ============================================================
const BAD_WORDS = [
  // ═══ شتائم عربية فصحى ═══
  'كلب', 'حمار', 'غبي', 'احمق', 'غليظ', 'سفيه', 'وقح', 'خسيس',
  'حقير', 'دنيء', 'وضيع', 'نذل', 'جبان', 'ساقط', 'فاسد',

  // ═══ شتائم جنسية (عربي) ═══
  'كس', 'زب', 'طيز', 'عير', 'نيك', 'منيك', 'اتناك', 'متناك',
  'شرموط', 'قحبة', 'عاهر', 'عاهرة', 'بغي', 'ساقطة', 'مومس',
  'كسمك', 'كسختك', 'كسمين', 'زبي', 'زبك', 'ازبي',
  'مص', 'لحس', 'بظر', 'خرم', 'فتحة',

  // ═══ شتائم عائلية ═══
  'ابن الكلب', 'بنت الكلب', 'ابن الشرموطة', 'بنت الشرموطة',
  'ابن القحبة', 'بنت القحبة', 'يلعن امك', 'لعن امك', 'امك',
  'ابوك', 'يلعن ابوك', 'اختك', 'يلعن دينك', 'يخرب بيتك',

  // ═══ شتائم مصرية شعبية ═══
  'عرص', 'خول', 'معرص', 'متخول', 'واطي', 'حيوان', 'بهيم',
  'زبالة', 'قمامة', 'وسخ', 'وسخة', 'قذر', 'قذرة', 'نجس',
  'خرا', 'خره', 'خراء', 'براز', 'تفل', 'بصاق',

  // ═══ الشتائم بالإنجليزي ═══
  'fuck', 'shit', 'bitch', 'ass', 'asshole', 'bastard', 'dick',
  'cock', 'pussy', 'cunt', 'whore', 'slut', 'motherfucker',
  'damn', 'hell', 'piss', 'screw', 'retard', 'idiot',

  // ═══ الشتائم بالفرانكو (عربي بحروف انجليزي) ═══
  'kalb', 'klab', 'k lb', 'k l b',
  '3ars', '3rs', 'ars', '3a rs',
  'khwal', 'kh wal', 'khwl',
  'nik', 'nk', 'n ik', 'naik',
  '5ara', 'khara', 'kh ara', 'kh ra',
  'kos', 'ks', 'k os', 'kos omak', 'kosmak',
  'zb', 'zob', 'z ob', 'zeby',
  'sharmoota', 'shar moota', 'shrmota',
  'a7ba', 'kahba', 'k7ba',

  // ═══ الشتائم بمسافات ورموز ═══
  'ك ل ب', 'ك.ل.ب', 'ك_ل_ب', 'ك-ل-ب', 'كـــلـــب',
  'ع ر ص', 'ع.ر.ص', 'ع_ر_ص', 'ع-ر-ص', 'عـــرص',
  'خ و ل', 'خ.و.ل', 'خ_و_ل', 'خ-و-ل', 'خـــول',
  'ن ي ك', 'ن.ي.ك', 'ن_ي_ك', 'نـــيـــك',
  'ك س', 'ك.س', 'ك_س', 'كـــس',
  'ز ب', 'ز.ب', 'ز_ب', 'زبـــي',

  // ═══ إيموجيات محظورة ═══
  '🖕',
];

// ============================================================
// 💾  تخزين التحذيرات
// ============================================================
const WARNINGS_FILE = './warnings.json';
let warnings = {};

function loadWarnings() {
  if (fs.existsSync(WARNINGS_FILE)) {
    try {
      warnings = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
    } catch (e) {
      warnings = {};
    }
  }
}

function saveWarnings() {
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2));
}

function getWarnings(userId) {
  return warnings[userId] || 0;
}

function addWarning(userId) {
  warnings[userId] = (warnings[userId] || 0) + 1;
  saveWarnings();
  return warnings[userId];
}

function resetWarnings(userId) {
  delete warnings[userId];
  saveWarnings();
}

// ============================================================
// 🔢  عدّ الشتائم في رسالة
// ============================================================
function countBadWords(text) {
  let count = 0;
  let cleanText = text.toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[ـ]/g, '')
    .replace(/\s+/g, ' ');

  for (const word of BAD_WORDS) {
    if (cleanText.includes(word.toLowerCase())) count++;
  }

  const noSpaces = cleanText.replace(/[\s._\-]/g, '');
  const coreWords = ['كلب', 'عرص', 'خول', 'نيك', 'كس', 'زب', 'شرموط', 'قحبة', 'خرا'];
  for (const word of coreWords) {
    if (noSpaces.includes(word)) count++;
  }

  const francoCheck = noSpaces.replace(/[0-9]/g, '');
  const francoWords = ['kalb', 'ars', 'khwal', 'nik', 'kos', 'zob', 'sharmoota'];
  for (const word of francoWords) {
    if (francoCheck.includes(word)) count++;
  }

  return count;
}

function containsBadWord(text) {
  return countBadWords(text) > 0;
}

// ============================================================
// 🛡️  حماية من السبام (تعدد الطلبات)
// ============================================================
const spamTracker = new Map(); // userId => { count, lastTime }
const SPAM_LIMIT   = 8;   // عدد الرسائل المسموح بيها
const SPAM_WINDOW  = 5000; // في 5 ثواني

function isSpamming(userId) {
  const now = Date.now();
  const data = spamTracker.get(userId) || { count: 0, lastTime: now };

  if (now - data.lastTime > SPAM_WINDOW) {
    // ريست لو فات 5 ثواني
    spamTracker.set(userId, { count: 1, lastTime: now });
    return false;
  }

  data.count++;
  data.lastTime = now;
  spamTracker.set(userId, data);

  return data.count > SPAM_LIMIT;
}

// ============================================================
// 🎵  تحميل الأغاني من يوتيوب
// ============================================================
const youtubeCooldowns = new Map();

function downloadYouTubeAudio(songName) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CONFIG.AUDIO_DIR)) {
      fs.mkdirSync(CONFIG.AUDIO_DIR, { recursive: true });
    }

    const safeName = songName.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim();
    const timestamp = Date.now();
    const outputTemplate = path.join(CONFIG.AUDIO_DIR, timestamp + '.%(ext)s');

    const command = `python -m yt_dlp -x --audio-format mp3 --audio-quality 0 --max-filesize 15m --write-thumbnail --convert-thumbnails jpg -o "${outputTemplate}" "ytsearch1:${safeName}"`;

    console.log(`\n🔍 جاري البحث عن: ${safeName}`);

    exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ خطأ في التحميل:', stderr);
        reject(new Error('فشل تحميل الأغنية'));
        return;
      }

      // FIX: قراءة الملفات بعد انتهاء التحميل فقط
      if (!fs.existsSync(CONFIG.AUDIO_DIR)) {
        reject(new Error('مجلد الأغاني غير موجود'));
        return;
      }

      const allFiles = fs.readdirSync(CONFIG.AUDIO_DIR);
      const mp3Files = allFiles.filter(f => f.endsWith('.mp3'));

      if (mp3Files.length === 0) {
        reject(new Error('لم يتم العثور على ملف الأغنية'));
        return;
      }

      const latestAudio = mp3Files
        .map(f => ({ name: f, time: fs.statSync(path.join(CONFIG.AUDIO_DIR, f)).mtime }))
        .sort((a, b) => b.time - a.time)[0];
      const audioPath = path.join(CONFIG.AUDIO_DIR, latestAudio.name);

      const thumbFiles = allFiles.filter(f =>
        f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp')
      );
      const latestThumb = thumbFiles.length > 0
        ? thumbFiles
            .map(f => ({ name: f, time: fs.statSync(path.join(CONFIG.AUDIO_DIR, f)).mtime }))
            .sort((a, b) => b.time - a.time)[0]
        : null;
      const thumbPath = latestThumb ? path.join(CONFIG.AUDIO_DIR, latestThumb.name) : null;

      resolve({ audioPath, thumbPath });
    });
  });
}

// ============================================================
// 🤖  إنشاء العميل - FIX: إعدادات puppeteer محسّنة
// ============================================================
loadWarnings();

const chromePath = getChromePath();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'group-manager-bot' }),
  puppeteer: {
    headless: true,
    ...(chromePath && { executablePath: chromePath }),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--no-first-run',
      '--ignore-certificate-errors',
      '--window-size=800,600',
    ],
    defaultViewport: { width: 800, height: 600 },
    timeout: 0,
    ignoreHTTPSErrors: true,
  },
});

// ============================================================
// 📱  Pairing Code (بدل QR Code)
// ============================================================
client.on('qr', async () => {
  clearInterval(loadTimer);
  console.clear();

  const PHONE_NUMBER = '67078736596';

  try {
    console.log('════════════════════════════════════════');
    console.log('   🔗 ربط واتساب عن طريق كود الربط');
    console.log(`   📱 الرقم: +${PHONE_NUMBER}`);
    console.log('════════════════════════════════════════\n');
    console.log('⏳ جاري طلب كود الربط...\n');

    const code = await client.requestPairingCode(PHONE_NUMBER);

    console.log('════════════════════════════════════════');
    console.log('   ✅ كود الربط الخاص بك:');
    console.log(`\n        🔑  ${code}\n`);
    console.log('════════════════════════════════════════');
    console.log('\n الخطوات:');
    console.log('   1. افتح واتساب على هاتفك');
    console.log('   2. الإعدادات ← الأجهزة المرتبطة');
    console.log('   3. ربط جهاز ← ربط بالرقم بدلاً من الـ QR');
    console.log('   4. أدخل الكود أعلاه\n');
  } catch (err) {
    console.error('❌ فشل طلب كود الربط:', err.message);
    process.exit(1);
  }
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
  console.log('   🛡️  حماية المجموعات: مفعّلة');
  console.log('   🎵  يوتيوب: مفعّل');
  console.log('   👋  الترحيب: مفعّل');
  console.log('   🕌  أوقات الصلاة: مفعّلة');
  console.log('════════════════════════════════════════');
  setTimeout(fetchPrayerTimes, 2000);
});

// ============================================================
// 👥  رسالة ترحيب
// ============================================================
client.on('group_join', async (notification) => {
  try {
    const chat = await notification.getChat();
    const contact = await notification.getContact();
    const name = contact.pushname || contact.verifiedName || contact.number;
    const groupName = chat.name;

    const welcomeMsg = `أهلاً وسهلاً يا *${name}* في جروب *${groupName}* 🌟\nيسعدنا انضمامك معنا! 🎉`;

    await chat.sendMessage(welcomeMsg);
    console.log(`✅ ترحيب: ${name} في ${groupName}`);
  } catch (err) {
    console.error('❌ خطأ في الترحيب:', err.message);
  }
});

// ============================================================
// 📨  معالجة الرسائل
// ============================================================
client.on('message_create', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;

    const sender = await msg.getContact();
    const senderId = sender.id.user;
    const senderName = sender.pushname || sender.number;
    const text = msg.body?.trim() || '';

    // FIX: التحقق من صلاحيات المشرف بشكل صحيح
    const participants = chat.participants || [];
    const participantObj = participants.find(p => p.id.user === senderId);
    const isGroupAdmin = participantObj ? (participantObj.isAdmin || participantObj.isSuperAdmin) : false;
    const isAdmin = CONFIG.ADMINS.includes(senderId) || isGroupAdmin;

    console.log(`\n📩 [${chat.name}] ${senderName}: ${text.substring(0, 50)}`);

    // ════════════════════════════════════════════════════════
    // 👤  فين امير؟
    // ════════════════════════════════════════════════════════
    if (
      text.includes('فين امير') ||
      text.includes('امير فين') ||
      text.includes('فين أمير') ||
      text.includes('أمير فين') ||
      text === 'امير' ||
      text === 'أمير'
    ) {
      await msg.reply('معلش 😅 امير مش موجود دلوقتي\nممكن يكون موجود لما يفضى عشان عنده مزاكرة وحاجات مهمة 📚');
      return;
    }

    // ════════════════════════════════════════════════════════
    // 🎵  أمر يوت - تحميل أغنية
    // ════════════════════════════════════════════════════════
    const youtubeMatch = text.match(/^يوت\s+(.+)/i) || text.match(/^يوتيوب\s+(.+)/i);
    if (youtubeMatch) {
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
        // إرسال الأغنية كرد على رسالة الطالب تحديداً
        await msg.reply(audioMedia, undefined, { sendAudioAsVoice: false });

        // مسح الملف من السيرفر فوراً بعد الإرسال
        fs.unlink(audioPath, (err) => {
          if (!err) console.log(`🗑️ تم مسح: ${audioPath}`);
        });

        // مسح رسالة الانتظار
        try { await waitMsg.delete(true); } catch (_) {}

        console.log(`✅ أغنية: ${songName}`);

      } catch (err) {
        await msg.reply('❌ فشل التحميل. تأكد من اسم الأغنية أو تثبيت yt-dlp.');
        console.error('❌ YouTube:', err.message);
      }
      return;
    }

    // ════════════════════════════════════════════════════════
    // 🔒  فحص قفل الملصقات والصور + الكتم + الصلاحيات
    // ════════════════════════════════════════════════════════
    if (!isAdmin) {
      const chatKey = chat.id._serialized;
      const perms = getPerms(chatKey, senderId);

      // كتم - حذف كل رسايل العضو المكتوم
      if (isMuted(chatKey, senderId)) {
        try { await msg.delete(true); } catch (_) {}
        return;
      }

      // سلب صلاحية الرسائل النصية
      if (msg.type === 'chat' && !perms.text) {
        try { await msg.delete(true); } catch (_) {}
        return;
      }

      // سلب صلاحية الملصقات (أو قفل جماعي)
      if (msg.type === 'sticker' && (!perms.sticker || stickerLocked.get(chatKey))) {
        try { await msg.delete(true); } catch (_) {}
        return;
      }

      // سلب صلاحية الصور/الوسائط (أو قفل جماعي)
      if ((msg.type === 'image' || msg.type === 'video' || msg.type === 'document') && (!perms.media || imageLocked.get(chatKey))) {
        try { await msg.delete(true); } catch (_) {}
        return;
      }

      // سلب صلاحية التسجيلات الصوتية
      if ((msg.type === 'ptt' || msg.type === 'audio') && !perms.voice) {
        try { await msg.delete(true); } catch (_) {}
        return;
      }
      // منع الروابط لو القفل مفعّل
      if (linkLocked.get(chatKey) && msg.type === 'chat' && containsLink(text)) {
        try {
          await msg.delete(true);
          await chat.sendMessage(
            `مش قولنا ممنوع الروابط واللينكات؟🙂\nممنوع الروابط ومتبعتهاش تاني يحب❤`,
            { mentions: [sender] }
          );
          console.log(`🔗 رابط حُذف من: ${senderName}`);
        } catch (_) {}
        return;
      }
    }

    // ════════════════════════════════════════════════════════
    // 🛡️  حماية من السبام
    // ════════════════════════════════════════════════════════
    if (!isAdmin && isSpamming(senderId)) {
      try {
        await msg.delete(true);
        console.log(`⚡ سبام من: ${senderName}`);
      } catch (_) {}
      return;
    }

    // ════════════════════════════════════════════════════════
    // 🛡️  فحص الشتائم
    // ════════════════════════════════════════════════════════
    if (!isAdmin && text.length > 0) {
      const badCount = countBadWords(text);
      if (badCount > 0) {
        try {
          await msg.delete(true);

          // لو الرسالة فيها أكتر من 6 شتايم → حظر فوري
          if (badCount > 6) {
            await chat.removeParticipants([sender.id._serialized]);
            resetWarnings(senderId);
            await chat.sendMessage(
              `🚫 تم حظر *${senderName}* (@${senderId}) فوراً بسبب رسالة تحتوي على ${badCount} شتيمة.`,
              { mentions: [sender] }
            );
            console.log(`🚫 حظر فوري (${badCount} شتيمة): ${senderName}`);
          } else {
            const warnCount = addWarning(senderId);
            if (warnCount >= CONFIG.MAX_WARNINGS) {
              await chat.removeParticipants([sender.id._serialized]);
              resetWarnings(senderId);
              await chat.sendMessage(
                `🚫 تم حظر *${senderName}* (@${senderId}) بسبب الشتائم المتكررة.`,
                { mentions: [sender] }
              );
              console.log(`🚫 حظر: ${senderName}`);
            } else {
              await chat.sendMessage(
                `⚠️ تحذير *${senderName}* (@${senderId})!\nاستخدمت ألفاظ غير لائقة.\nالتحذيرات: ${warnCount}/${CONFIG.MAX_WARNINGS}`,
                { mentions: [sender] }
              );
              console.log(`⚠️ تحذير ${warnCount}: ${senderName}`);
            }
          }
        } catch (err) {
          console.error('❌ خطأ في الحظر/التحذير:', err.message);
        }
        return;
      }
    }

    // ════════════════════════════════════════════════════════
    // 👮  أوامر المشرفين
    // ════════════════════════════════════════════════════════
    // ── صاحب الجروب ──
    if (
      text.includes('مين صاحب الروم') ||
      text.includes('مين صاحب الجروب') ||
      text.includes('صاحب الروم مين') ||
      text.includes('صاحب الجروب مين')
    ) {
      await chat.sendMessage('👑 *AMIR* هو صاحب الروم');
      return;
    }

    if (!isAdmin) return;

    // ── كتم (رد على رسالة) ──
    if (text === 'كتم') {
      if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو اللي تريد تكتمه.'); return; }
      const q = await msg.getQuotedMessage();
      const target = await q.getContact();
      const key = `${chat.id._serialized}:${target.id.user}`;
      mutedUsers.add(key);
      await chat.sendMessage(`🔇 تم كتم *${target.pushname || target.number}* — رسايله هتتحذف تلقائياً`, { mentions: [target] });
      return;
    }

    // ── رفع الكتم (رد على رسالة) ──
    if (text === 'رفع الكتم' || text === 'فك الكتم') {
      if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو اللي تريد ترفع كتمه.'); return; }
      const q = await msg.getQuotedMessage();
      const target = await q.getContact();
      const key = `${chat.id._serialized}:${target.id.user}`;
      mutedUsers.delete(key);
      await chat.sendMessage(`🔊 تم رفع الكتم عن *${target.pushname || target.number}*`, { mentions: [target] });
      return;
    }

    // ── قائمة الصلاحيات ──
    if (text === 'قائمة الصلاحيات' || text === 'الصلاحيات') {
      const parts = chat.participants || [];
      let listMsg = `📋 *قائمة الصلاحيات — ${chat.name}*\n${'─'.repeat(30)}\n`;
      let idx = 1;
      for (const p of parts) {
        const uid  = p.id.user;
        const role = (p.isAdmin || p.isSuperAdmin) ? '👑 أدمن' : '👤 عضو';
        const muted = mutedUsers.has(`${chat.id._serialized}:${uid}`) ? '🔇مكتوم ' : '';
        const perms = getPerms(chat.id._serialized, uid);
        const st  = perms.sticker ? '✅' : '❌';
        const med = perms.media   ? '✅' : '❌';
        const vc  = perms.voice   ? '✅' : '❌';
        const tx  = perms.text    ? '✅' : '❌';
        listMsg += `\n*${idx}.* +${uid} ${role} ${muted}\n`;
        listMsg += `   💬رسائل:${tx}  🖼️وسائط:${med}  🎤صوت:${vc}  😀ملصقات:${st}\n`;
        idx++;
      }
      listMsg += `\n${'─'.repeat(30)}\nللتحكم: رد على رسالة العضو واكتب:\n*سلب صلاحية ملصقات* أو *منح صلاحية ملصقات*\n*سلب صلاحية وسائط* / *سلب صلاحية صوت* / *سلب صلاحية رسائل*`;
      await chat.sendMessage(listMsg);
      return;
    }

    // ── سلب/منح صلاحية (رد على رسالة) ──
    const permActions = {
      'سلب صلاحية ملصقات':  { perm: 'sticker', val: false },
      'منح صلاحية ملصقات':  { perm: 'sticker', val: true  },
      'سلب صلاحية وسائط':   { perm: 'media',   val: false },
      'منح صلاحية وسائط':   { perm: 'media',   val: true  },
      'سلب صلاحية صور':     { perm: 'media',   val: false },
      'منح صلاحية صور':     { perm: 'media',   val: true  },
      'سلب صلاحية صوت':     { perm: 'voice',   val: false },
      'منح صلاحية صوت':     { perm: 'voice',   val: true  },
      'سلب صلاحية رسائل':   { perm: 'text',    val: false },
      'منح صلاحية رسائل':   { perm: 'text',    val: true  },
    };

    if (permActions[text]) {
      if (!msg.hasQuotedMsg) { await msg.reply('❌ اعمل رد على رسالة العضو اللي تريد تعدل صلاحيته.'); return; }
      const q = await msg.getQuotedMessage();
      const target = await q.getContact();
      const { perm, val } = permActions[text];
      const perms = getPerms(chat.id._serialized, target.id.user);
      perms[perm] = val;
      const action = val ? '✅ منح' : '❌ سلب';
      const permNames = { sticker: 'الملصقات', media: 'الوسائط/الصور', voice: 'التسجيلات الصوتية', text: 'الرسائل' };
      await chat.sendMessage(
        `${action} صلاحية *${permNames[perm]}* ${val ? 'لـ' : 'من'} *${target.pushname || target.number}*`,
        { mentions: [target] }
      );
      return;
    }

    // ── قفل/فتح الروابط ──
    if (text === 'قفل الروابط' || text === 'منع الروابط') {
      linkLocked.set(chat.id._serialized, true);
      await chat.sendMessage('🔒 تم قفل الروابط — أي رابط هيتحذف تلقائياً');
      return;
    }

    if (text === 'فتح الروابط' || text === 'سماح الروابط') {
      linkLocked.set(chat.id._serialized, false);
      await chat.sendMessage('🔓 تم فتح الروابط');
      return;
    }

    // ── اقفل المكالمه الجماعيه ──
    if (text === 'اقفل المكالمه' || text === 'اقفل المكالمة' || text === 'اقفل المكالمه الجماعيه') {
      try {
        await chat.setMessagesAdminsOnly(true);
        await chat.sendMessage('📵 تم قفل المكالمات الجماعية');
        console.log(`📵 قفل مكالمة: ${chat.name}`);
      } catch (err) {
        await msg.reply('❌ فشل قفل المكالمة. تأكد إن البوت مشرف في الجروب.');
      }
      return;
    }

    // ── قفل/فتح الملصقات ──
    if (text === 'قفل الملصقات') {
      stickerLocked.set(chat.id._serialized, true);
      await chat.sendMessage('🔒 تم قفل الملصقات — أي ملصق هيتحذف تلقائياً');
      console.log(`🔒 قفل ملصقات: ${chat.name}`);
      return;
    }

    if (text === 'فتح الملصقات') {
      stickerLocked.set(chat.id._serialized, false);
      await chat.sendMessage('🔓 تم فتح الملصقات');
      console.log(`🔓 فتح ملصقات: ${chat.name}`);
      return;
    }

    // ── قفل/فتح الصور ──
    if (text === 'قفل الصور') {
      imageLocked.set(chat.id._serialized, true);
      await chat.sendMessage('🔒 تم قفل الصور — أي صورة هتتحذف تلقائياً');
      console.log(`🔒 قفل صور: ${chat.name}`);
      return;
    }

    if (text === 'فتح الصور') {
      imageLocked.set(chat.id._serialized, false);
      await chat.sendMessage('🔓 تم فتح الصور');
      console.log(`🔓 فتح صور: ${chat.name}`);
      return;
    }

    // ── اضافة رقم ──
    if (text.startsWith('اضافة') || text.startsWith('add')) {
      const parts = text.split(' ');
      let number = parts[1]?.trim();
      if (!number) {
        await msg.reply('❌ اكتب الرقم بالشكل ده:\nadd 201XXXXXXXXX\nأو: اضافة 01XXXXXXXXX');
        return;
      }
      number = number.replace(/[^0-9]/g, '');
      if (number.startsWith('0')) number = '2' + number;
      const numberId = `${number}@c.us`;
      try {
        await chat.addParticipants([numberId]);
        await chat.sendMessage(`✅ تمت إضافة +${number} للجروب 🎉`);
        console.log(`✅ إضافة: ${number} بواسطة ${senderName}`);
      } catch (err) {
        await msg.reply(`❌ فشل إضافة الرقم.\nتأكد إن الرقم صح وعنده واتساب.`);
        console.error('❌ إضافة:', err.message);
      }
      return;
    }

    // ── مسح كل الرسايل (رد على رسالة عضو) ──
    if (text === 'مسح كل الرسايل' || text === 'مسح كل رسايله') {
      if (!msg.hasQuotedMsg) {
        await msg.reply('❌ اعمل رد على رسالة العضو اللي تريد تمسح رسايله.');
        return;
      }
      const q = await msg.getQuotedMessage();
      const target = await q.getContact();
      const targetId = target.id._serialized;

      await msg.reply(`🗑️ جاري مسح رسايل *${target.pushname || target.number}*...`);

      try {
        const messages = await chat.fetchMessages({ limit: 1000 });
        let count = 0;
        for (const m of messages) {
          if (m.author === targetId || m.from === targetId) {
            try {
              await m.delete(true);
              count++;
              await new Promise(r => setTimeout(r, 300));
            } catch (_) {}
          }
        }
        await chat.sendMessage(`✅ تم مسح ${count} رسالة لـ *${target.pushname || target.number}*`);
        console.log(`🗑️ مسح ${count} رسالة لـ ${target.id.user}`);
      } catch (err) {
        await msg.reply('❌ فشل مسح الرسايل: ' + err.message);
      }
      return;
    }

    // ── مسح (حذف رسالة) ──
    if (text === 'مسح' || text === 'احذف') {
      if (msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        await quotedMsg.delete(true);
        await msg.react('✅');
        console.log(`🗑️  حذف رسالة بواسطة: ${senderName}`);
      } else {
        await msg.reply('❌ اعمل رد على الرسالة اللي تريد تحذفها.');
      }
      return;
    }

    // ── حظر ──
    if (text === 'حظر' || text === 'بان') {
      if (msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        const targetContact = await quotedMsg.getContact();
        await chat.removeParticipants([targetContact.id._serialized]);
        await chat.sendMessage(
          `🚫 تم حظر *${targetContact.pushname || targetContact.number}* (@${targetContact.id.user})`,
          { mentions: [targetContact] }
        );
        console.log(`🚫 حظر: ${targetContact.id.user} بواسطة ${senderName}`);
      } else {
        await msg.reply('❌ اعمل رد على رسالة الشخص اللي تريد تحظره.');
      }
      return;
    }

    // ── حظر @رقم أو حظر رقم (بدون رد) ──
    if (text.startsWith('حظر ') || text.startsWith('بان ')) {
      const parts = text.split(' ');
      let number = parts[1]?.replace(/[^0-9]/g, '');
      if (!number) {
        await msg.reply('❌ اكتب الرقم صح:\nحظر 201XXXXXXXXX\nأو: حظر 01XXXXXXXXX');
        return;
      }
      if (number.startsWith('0')) number = '2' + number;
      const numberId = `${number}@c.us`;
      try {
        await chat.removeParticipants([numberId]);
        await chat.sendMessage(`🚫 تم حظر +${number} من الجروب`);
        console.log(`🚫 حظر بالرقم: ${number} بواسطة ${senderName}`);
      } catch (err) {
        await msg.reply('❌ فشل الحظر. تأكد إن الرقم موجود في الجروب.');
        console.error('❌ حظر بالرقم:', err.message);
      }
      return;
    }

    // ── !حظر @شخص ──
    if (text.startsWith('!حظر') || text.startsWith('!ban')) {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await msg.reply('❌ اعمل رد على رسالة واكتب: حظر\nأو اذكر الشخص: !حظر @شخص');
        return;
      }
      for (const contact of mentioned) {
        await chat.removeParticipants([contact.id._serialized]);
        await chat.sendMessage(`🚫 تم حظر *${contact.pushname || contact.number}* (@${contact.id.user})`, { mentions: [contact] });
      }
      return;
    }

    // ── !طرد @شخص ──
    if (text.startsWith('!طرد') || text.startsWith('!kick')) {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await msg.reply('❌ اذكر الشخص: !طرد @شخص');
        return;
      }
      for (const contact of mentioned) {
        await chat.removeParticipants([contact.id._serialized]);
        await chat.sendMessage(`👢 تم طرد *${contact.pushname || contact.number}* (@${contact.id.user})`, { mentions: [contact] });
      }
      return;
    }

    // ── !تحذير @شخص ──
    if (text.startsWith('!تحذير') || text.startsWith('!warn')) {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await msg.reply('❌ اذكر الشخص: !تحذير @شخص');
        return;
      }
      for (const contact of mentioned) {
        const count = addWarning(contact.id.user);
        await chat.sendMessage(
          `⚠️ تحذير *${contact.pushname || contact.number}* (@${contact.id.user})\nالتحذيرات: ${count}/${CONFIG.MAX_WARNINGS}`,
          { mentions: [contact] }
        );
      }
      return;
    }

    // ── !مسح @شخص (مسح تحذيرات) ──
    if (text.startsWith('!مسح') || text.startsWith('!reset')) {
      const mentioned = await msg.getMentions();
      if (mentioned.length === 0) {
        await msg.reply('❌ اذكر الشخص: !مسح @شخص');
        return;
      }
      for (const contact of mentioned) {
        resetWarnings(contact.id.user);
        await msg.reply(`✅ تم مسح تحذيرات @${contact.id.user}`);
      }
      return;
    }

    // ── !معلومات ──
    if (text === '!معلومات' || text === '!info') {
      const parts = chat.participants || [];
      const admins = parts.filter(p => p.isAdmin || p.isSuperAdmin).length;
      const info =
        `📋 *معلومات المجموعة*\n\n` +
        `• الاسم: ${chat.name}\n` +
        `• الأعضاء: ${parts.length}\n` +
        `• المشرفون: ${admins}`;
      await msg.reply(info);
      return;
    }

    // ── !مساعدة ──
    if (text === '!مساعدة' || text === '!help') {
      const helpMsg =
        `🤖 *أوامر البوت*\n\n` +
        `*🎵 للجميع:*\n` +
        `يوت [اسم الأغنية] - تحميل أغنية\n\n` +
        `*👮 للمشرفين:*\n` +
        `قفل الملصقات / فتح الملصقات\n` +
        `قفل الصور / فتح الصور\n` +
        `مسح - رد على رسالة تحذفها\n` +
        `حظر - رد على رسالة تحظر صاحبها\n` +
        `!حظر @شخص - حظر عضو\n` +
        `!طرد @شخص - طرد عضو\n` +
        `!تحذير @شخص - إعطاء تحذير\n` +
        `!مسح @شخص - مسح تحذيرات\n` +
        `اضافة [رقم] - إضافة عضو للجروب\n` +
        `!معلومات - معلومات المجموعة`;
      await msg.reply(helpMsg);
      return;
    }

  } catch (err) {
    console.error('❌ خطأ في معالجة الرسالة:', err.message);
  }
});

// ============================================================
// 🔌  معالجة الأخطاء والانقطاع
// ============================================================
client.on('disconnected', (reason) => {
  console.log('⚠️  انقطع الاتصال:', reason);
  // FIX: تأخير قبل إعادة الاتصال لتجنب حلقة لا نهائية
  console.log('🔄 إعادة الاتصال خلال 10 ثوانٍ...');
  setTimeout(() => {
    client.initialize().catch(err => {
      console.error('❌ فشل إعادة الاتصال:', err.message);
    });
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
    const files = fs.readdirSync(CONFIG.AUDIO_DIR);
    files.forEach(f => {
      try { fs.unlinkSync(path.join(CONFIG.AUDIO_DIR, f)); } catch (_) {}
    });
  }
  process.exit(0);
});
