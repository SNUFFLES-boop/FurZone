#!/usr/bin/env bash
# Builds out/ (the app) and FurZone_Setup.exe from the web app in ../dist/web (run `npm run build` first).
# Needs the .NET 10 SDK and NSIS (makensis). VERSION_CODE sets the version (1.0.<code>).
set -euo pipefail
cd "$(dirname "$0")"
VERSION_CODE="${VERSION_CODE:-1}"
GITHUB_REPO="${GITHUB_REPO:-SNUFFLES-boop/FurZone}"
[ -f ../dist/web/index.html ] || { echo "error: run npm run build first" >&2; exit 1; }
rm -rf out
dotnet publish FurZone.csproj -c Release -p:VersionCode="$VERSION_CODE" -p:GitHubRepo="$GITHUB_REPO" -o out -nologo -v quiet
rm -f out/*.pdb out/*.xml out/Microsoft.Web.WebView2.Wpf.dll
mkdir -p out/web
cp -R ../dist/web/. out/web/
makensis -V2 -DVERSION="1.0.$VERSION_CODE" -DSRC=out installer.nsi
echo "Built FurZone_Setup.exe ($(du -h FurZone_Setup.exe | cut -f1))"
