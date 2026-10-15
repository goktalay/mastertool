#!/usr/bin/env bash
# Master Tool exe'lerini mastertool.download'a yükler (sözleşme v1 §7).
# Kullanım: upload-mastertool.sh <sürüm> <setup.exe> [notlar] [portable.exe]
# Anahtar MASTERTOOL_RELEASE_KEY ortam değişkeninden okunur (GitHub secret); tanımlı değilse uyarı verip çıkar.
#
# Parçalı yükleme (parça ≤ 90 MB, sırayla):
#   POST /api/mt/releases/<sürüm>/setup     multipart: file, part, parts, filename (Master-Tool-Setup-<sürüm>.exe), notes
#   POST /api/mt/releases/<sürüm>/portable  multipart: file, part, parts, filename (Master-Tool-Portable-<sürüm>.exe)
# Ara parça {ok, received}; son parça {ok, version, kind, sha256, size}.
# Hatalar: 409 exists, 404 no_release, 409 part_order, 422 not_exe, 422 invalid_version, 403.
set -euo pipefail

VERSION="$1"
SETUP="$2"
NOTES="${3:-}"
PORTABLE="${4:-}"
[ -n "$NOTES" ] || NOTES="Master Tool $VERSION"
API="${MT_API:-https://mastertool.download}/api/mt/releases/$VERSION"
PART_BYTES="${MT_PART_BYTES:-90000000}"     # test için küçültülebilir

if [ -z "${MASTERTOOL_RELEASE_KEY:-}" ]; then
  echo "::warning::MASTERTOOL_RELEASE_KEY tanımlı değil; mastertool.download'a yükleme atlandı."
  exit 0
fi

# Dosyayı ≤ PART_BYTES parçalar halinde sırayla gönderir; son HTTP kodunu yazdırır
post_parts() { # post_parts <url> <dosya> <dosya adı> [ek -F argümanları...]
  local url="$1" file="$2" name="$3"; shift 3
  # Göreli geçici klasör: Windows'taki curl, Git Bash'in /tmp yollarını okuyamaz
  local dir; dir=$(mktemp -d ./.mt-parts.XXXXXX)
  split -b "$PART_BYTES" -d -a 3 "$file" "$dir/part."
  local parts=( "$dir"/part.* ) total=${#parts[@]} i=0 code=""
  for p in "${parts[@]}"; do
    code=$(curl -sS -o response.json -w '%{http_code}' -X POST "$url" -H "X-Release-Key: $MASTERTOOL_RELEASE_KEY" \
      -F "file=@$p;filename=$name" -F "part=$i" -F "parts=$total" -F "filename=$name" "$@")
    echo "  parça $((i + 1))/$total → HTTP $code $(cat response.json)" >&2
    case "$code" in 200|201) ;; *) break ;; esac
    i=$((i + 1))
  done
  rm -rf "$dir"
  echo "$code"
}

# --- Kurulum ------------------------------------------------------------------
echo "Kurulum: $SETUP ($(stat -c %s "$SETUP") bayt), sürüm $VERSION"
HTTP=$(post_parts "$API/setup" "$SETUP" "Master-Tool-Setup-$VERSION.exe" -F "notes=$NOTES")
case "$HTTP" in
  200|201) echo "mastertool.download: kurulum $VERSION yüklendi." ;;
  409) echo "::notice::mastertool.download'da $VERSION kurulumu zaten var ya da parça sırası bozuk (409); ayrıntı yukarıda." ;;
  *) echo "::error::Kurulum yüklemesi başarısız (HTTP $HTTP)."; exit 1 ;;
esac

# --- Portable (isteğe bağlı) ----------------------------------------------------
if [ -n "$PORTABLE" ] && [ -f "$PORTABLE" ]; then
  echo "Portable: $PORTABLE ($(stat -c %s "$PORTABLE") bayt)"
  HTTP=$(post_parts "$API/portable" "$PORTABLE" "Master-Tool-Portable-$VERSION.exe") || HTTP=000
  case "$HTTP" in
    200|201) echo "mastertool.download: portable $VERSION yüklendi." ;;
    409) echo "::notice::mastertool.download'da $VERSION portable zaten var (409); atlandı." ;;
    *) echo "::warning::Portable yüklemesi başarısız (HTTP $HTTP); kurulum yüklendiği için yayın sürüyor." ;;
  esac
fi
