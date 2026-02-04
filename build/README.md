# Build Assets

Place icon files in this directory for building installers.

## Required Icons

### macOS
- `icon.icns` - macOS app icon (512x512 or 1024x1024)

### Windows
- `icon.ico` - Windows app icon (256x256)

### Linux
Place PNG icons in the `icons/` subdirectory:
- `icons/16x16.png`
- `icons/32x32.png`
- `icons/48x48.png`
- `icons/64x64.png`
- `icons/128x128.png`
- `icons/256x256.png`
- `icons/512x512.png`

## Generate Icons

You can use tools like:
- [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
- [png2icons](https://www.npmjs.com/package/png2icons)

Example with electron-icon-builder:
```bash
npm install -g electron-icon-builder
electron-icon-builder --input=./icon.png --output=./build
```
