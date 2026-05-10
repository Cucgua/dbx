#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VERSION="$(grep -m1 '<version>' "$ROOT/pom.xml" | sed -E 's/.*<version>([^<]+)<.*/\1/')"
PACKAGE_DIR="$ROOT/dist/dbx-jdbc-plugin-$VERSION"
ZIP_PATH="$ROOT/dist/dbx-jdbc-plugin-$VERSION.zip"

cd "$ROOT"
mvn -q -DskipTests package

rm -rf "$PACKAGE_DIR" "$ZIP_PATH"
mkdir -p "$PACKAGE_DIR/bin" "$PACKAGE_DIR/lib"
cp "$ROOT/manifest.json" "$PACKAGE_DIR/manifest.json"
cp "$ROOT/bin/dbx-jdbc-plugin" "$PACKAGE_DIR/bin/dbx-jdbc-plugin"
cp "$ROOT/target/dbx-jdbc-plugin-$VERSION-all.jar" "$PACKAGE_DIR/lib/dbx-jdbc-plugin.jar"
chmod +x "$PACKAGE_DIR/bin/dbx-jdbc-plugin"

(cd "$ROOT/dist" && zip -qr "dbx-jdbc-plugin-$VERSION.zip" "dbx-jdbc-plugin-$VERSION")
echo "$ZIP_PATH"
