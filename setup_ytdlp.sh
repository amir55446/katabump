#!/bin/bash
# ============================================================
#   سكريبت تثبيت yt-dlp + ffmpeg على السيرفر
#   شغّله مرة واحدة بالأمر: bash setup_ytdlp.sh
# ============================================================

echo "════════════════════════════════════════"
echo "   🔧 جاري تثبيت yt-dlp + ffmpeg"
echo "════════════════════════════════════════"

# ── 1. تحديث الحزم ──────────────────────────────────────────
echo ""
echo "📦 [1/5] تحديث قائمة الحزم..."
apt-get update -y 2>/dev/null || true

# ── 2. تثبيت Python3 + pip ──────────────────────────────────
echo ""
echo "🐍 [2/5] تثبيت Python3 و pip..."
apt-get install -y python3 python3-pip curl wget 2>/dev/null || \
  yum install -y python3 python3-pip curl wget 2>/dev/null || true

# ── 3. تثبيت ffmpeg ─────────────────────────────────────────
echo ""
echo "🎬 [3/5] تثبيت ffmpeg..."
apt-get install -y ffmpeg 2>/dev/null || \
  yum install -y ffmpeg 2>/dev/null || \
  snap install ffmpeg 2>/dev/null || true

# فحص ffmpeg
if command -v ffmpeg &>/dev/null; then
  echo "✅ ffmpeg تم تثبيته: $(ffmpeg -version 2>&1 | head -1)"
else
  echo "⚠️  ffmpeg مش موجود — هنثبته يدوياً..."
  # تحميل ffmpeg static build
  cd /tmp
  wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -O ffmpeg.tar.xz
  tar -xf ffmpeg.tar.xz
  FFMPEG_DIR=$(ls -d ffmpeg-*-amd64-static 2>/dev/null | head -1)
  if [ -d "$FFMPEG_DIR" ]; then
    cp "$FFMPEG_DIR/ffmpeg" /usr/local/bin/ffmpeg
    cp "$FFMPEG_DIR/ffprobe" /usr/local/bin/ffprobe
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
    echo "✅ ffmpeg تم تثبيته يدوياً"
  else
    echo "❌ فشل تثبيت ffmpeg"
  fi
  cd -
fi

# ── 4. تثبيت yt-dlp ─────────────────────────────────────────
echo ""
echo "📥 [4/5] تثبيت yt-dlp..."

# طريقة 1: عن طريق pip
pip3 install -U yt-dlp 2>/dev/null && echo "✅ yt-dlp تم تثبيته عن طريق pip" || {

  # طريقة 2: تحميل binary مباشرة
  echo "⚠️  pip فشل، جاري التحميل المباشر..."
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod +x /usr/local/bin/yt-dlp
  echo "✅ yt-dlp تم تحميله مباشرة"
}

# ── 5. فحص التثبيت ──────────────────────────────────────────
echo ""
echo "🔍 [5/5] فحص التثبيت..."

echo ""
echo "── Python ──────────────────────────────"
python3 --version 2>&1 && echo "✅ Python OK" || echo "❌ Python غير موجود"

echo ""
echo "── pip ─────────────────────────────────"
pip3 --version 2>&1 && echo "✅ pip OK" || echo "❌ pip غير موجود"

echo ""
echo "── yt-dlp ──────────────────────────────"
yt-dlp --version 2>/dev/null && echo "✅ yt-dlp OK (binary)" || \
python3 -m yt_dlp --version 2>/dev/null && echo "✅ yt-dlp OK (python module)" || \
echo "❌ yt-dlp غير موجود"

echo ""
echo "── ffmpeg ──────────────────────────────"
ffmpeg -version 2>&1 | head -1 && echo "✅ ffmpeg OK" || echo "❌ ffmpeg غير موجود"

echo ""
echo "════════════════════════════════════════"
echo "   ✅ انتهى التثبيت!"
echo "   شغّل البوت الآن: node index.js"
echo "════════════════════════════════════════"
