#!/usr/bin/env bash
# Builds build/FurZone.apk without Gradle, from the web app in ../dist/web (run `npm run build` first).
#
# Needs a JDK (17+) and, from the Android SDK: aapt2, d8 (or dx), zipalign, apksigner and a platform
# android.jar. They're found in $ANDROID_HOME / $ANDROID_SDK_ROOT / /usr/lib/android-sdk or on PATH;
# override any of them with AAPT2, D8, DX, ZIPALIGN, APKSIGNER or ANDROID_JAR.
#
# Signing: KEYSTORE (default signing/furzone.jks), KEYSTORE_PASSWORD and KEY_ALIAS (default furzone).
# Every update must be signed with the same key, or Android refuses to install it over the old app.
set -euo pipefail
cd "$(dirname "$0")"

VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0.$VERSION_CODE}"
GITHUB_REPO="${GITHUB_REPO:-SNUFFLES-boop/FurZone}"
case "$GITHUB_REPO" in
    *[!A-Za-z0-9._/-]* | */*/* | /* | */) echo "GITHUB_REPO must look like owner/repo" >&2; exit 1 ;;
esac
MIN_SDK=26
TARGET_SDK=35
PACKAGE_DIR=com/snufflesboop/furzone
KEYSTORE="${KEYSTORE:-signing/furzone.jks}"
KEY_ALIAS="${KEY_ALIAS:-furzone}"
if [ -z "${KEYSTORE_PASSWORD:-}" ] && [ -f signing/password.txt ]; then
    KEYSTORE_PASSWORD="$(tr -d '\r\n' < signing/password.txt)"
fi
: "${KEYSTORE_PASSWORD:?set KEYSTORE_PASSWORD (or put it in signing/password.txt)}"
OUT=build
APK="$OUT/FurZone.apk"
WEB=../dist/web

if [ ! -f "$WEB/index.html" ]; then
    echo "error: $WEB/index.html is missing; run npm run build first" >&2
    exit 1
fi

sdk_dirs() {
    for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" /usr/local/lib/android/sdk /usr/lib/android-sdk; do
        if [ -n "$d" ] && [ -d "$d" ]; then echo "$d"; fi
    done
}

find_build_tool() {
    local name=$1 sdk dir
    for sdk in $(sdk_dirs); do
        for dir in $(ls -d "$sdk"/build-tools/*/ 2>/dev/null | sort -rV); do
            if [ -x "$dir$name" ]; then
                echo "$dir$name"
                return
            fi
        done
    done
    command -v "$name" || true
}

find_android_jar() {
    local sdk api
    for api in 35 34 33; do
        for sdk in $(sdk_dirs); do
            if [ -f "$sdk/platforms/android-$api/android.jar" ]; then
                echo "$sdk/platforms/android-$api/android.jar"
                return
            fi
        done
    done
}

AAPT2="${AAPT2:-$(find_build_tool aapt2)}"
D8="${D8:-$(find_build_tool d8)}"
DX="${DX:-$(find_build_tool dx)}"
ZIPALIGN="${ZIPALIGN:-$(find_build_tool zipalign)}"
APKSIGNER="${APKSIGNER:-$(find_build_tool apksigner)}"
ANDROID_JAR="${ANDROID_JAR:-$(find_android_jar)}"
for v in AAPT2 ZIPALIGN APKSIGNER ANDROID_JAR; do
    if [ -z "${!v}" ]; then
        echo "error: could not find $v (see the top of build.sh)" >&2
        exit 1
    fi
done
if [ -z "$D8" ] && [ -z "$DX" ]; then
    echo "error: need d8 or dx from the Android build-tools" >&2
    exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/gen/$PACKAGE_DIR" "$OUT/classes" "$OUT/dex" "$OUT/assets/www"
cp -R "$WEB/." "$OUT/assets/www/"

cat > "$OUT/gen/$PACKAGE_DIR/BuildConfig.java" <<JAVA
package com.snufflesboop.furzone;

public final class BuildConfig {
    public static final String VERSION_NAME = "$VERSION_NAME";
    public static final int VERSION_CODE = $VERSION_CODE;
    public static final String GITHUB_REPO = "$GITHUB_REPO";

    private BuildConfig() {
    }
}
JAVA

echo "==> resources"
"$AAPT2" compile --dir res -o "$OUT/res.zip"
"$AAPT2" link -I "$ANDROID_JAR" \
    --manifest AndroidManifest.xml \
    --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
    -A "$OUT/assets" \
    -o "$OUT/base.apk" "$OUT/res.zip"

echo "==> java"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')

echo "==> dex"
if [ -n "$D8" ]; then
    "$D8" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
else
    "$DX" --dex --min-sdk-version="$MIN_SDK" --output="$OUT/dex/classes.dex" "$OUT/classes"
fi

echo "==> package"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -qX ../unsigned.apk classes*.dex)
"$ZIPALIGN" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
    --ks-pass "pass:$KEYSTORE_PASSWORD" --key-pass "pass:$KEYSTORE_PASSWORD" \
    --out "$APK" "$OUT/aligned.apk"
"$APKSIGNER" verify "$APK"
echo "Built $APK ($(du -h "$APK" | cut -f1))"
