// utils/fontLoader.js - 完全重写的版本

// 字体加载状态缓存
const fontCache = new Map();

/**
 * 验证字体文件是否有效
 */
async function validateFont(fontUrl) {
  try {
    const response = await fetch(fontUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const header = new DataView(arrayBuffer, 0, 4).getUint32(0, false);

    // 有效的字体文件头
    const validHeaders = [
      0x00010000, // TrueType
      0x74727565, // 'true'
      0x4f54544f, // 'OTTO' - OpenType
      0x774f4646, // 'wOFF'
      0x774f4632, // 'wOF2'
    ];

    if (!validHeaders.includes(header)) {
      throw new Error(`Invalid font header: 0x${header.toString(16)}`);
    }

    return { valid: true, arrayBuffer, size: arrayBuffer.byteLength };
  } catch (error) {
    console.error("Font validation failed:", error);
    return { valid: false, error: error.message };
  }
}

/**
 * 使用 FontFace API 加载字体
 */
async function loadWithFontFace(fontName, fontUrl) {
  const validation = await validateFont(fontUrl);

  if (!validation.valid) {
    throw new Error(`Font validation failed: ${validation.error}`);
  }

  const fontFace = new FontFace(fontName, validation.arrayBuffer);
  await fontFace.load();
  document.fonts.add(fontFace);

  return true;
}

/**
 * 使用 CSS @font-face 加载字体
 */
function loadWithCSS(fontName, fontUrl) {
  return new Promise((resolve, reject) => {
    // 检查是否已经添加过相同的样式
    const existingStyle = document.querySelector(
      `style[data-font="${fontName}"]`
    );
    if (existingStyle) {
      resolve(true);
      return;
    }

    const style = document.createElement("style");
    style.setAttribute("data-font", fontName);

    const format = fontUrl.endsWith(".otf") ? "opentype" : "truetype";
    style.textContent = `
      @font-face {
        font-family: '${fontName}';
        src: url('${fontUrl}') format('${format}');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;

    document.head.appendChild(style);

    // 检查字体是否加载完成
    let attempts = 0;
    const maxAttempts = 100; // 10秒超时

    const checkFont = () => {
      attempts++;

      if (document.fonts.check(`12px "${fontName}"`)) {
        resolve(true);
      } else if (attempts >= maxAttempts) {
        reject(new Error(`Font loading timeout: ${fontName}`));
      } else {
        setTimeout(checkFont, 100);
      }
    };

    checkFont();
  });
}

/**
 * 主要的字体加载函数
 */
export async function loadCustomFont(fontName, fontUrl) {
  // 检查缓存
  if (fontCache.has(fontName)) {
    const cached = fontCache.get(fontName);
    if (cached.success) {
      console.log(`Font already loaded: ${fontName}`);
      return true;
    }
  }

  // 检查是否是系统字体
  if (!fontUrl) {
    console.log(`System font: ${fontName}`);
    fontCache.set(fontName, { success: true, method: "system" });
    return true;
  }

  console.log(`Loading custom font: ${fontName} from ${fontUrl}`);

  try {
    // 方法1: 尝试 FontFace API
    await loadWithFontFace(fontName, fontUrl);
    console.log(`✅ Font loaded with FontFace API: ${fontName}`);
    fontCache.set(fontName, { success: true, method: "fontface" });
    return true;
  } catch (fontFaceError) {
    console.warn(`FontFace API failed for ${fontName}:`, fontFaceError.message);

    try {
      // 方法2: 尝试 CSS 方式
      await loadWithCSS(fontName, fontUrl);
      console.log(`✅ Font loaded with CSS: ${fontName}`);
      fontCache.set(fontName, { success: true, method: "css" });
      return true;
    } catch (cssError) {
      console.error(
        `All font loading methods failed for ${fontName}:`,
        cssError.message
      );
      fontCache.set(fontName, { success: false, error: cssError.message });
      return false;
    }
  }
}

/**
 * 批量加载字体
 */
export async function loadFonts(fonts) {
  const results = {};

  for (const font of fonts) {
    try {
      const success = await loadCustomFont(font.name, font.url);
      results[font.name] = { success, error: null };
    } catch (error) {
      results[font.name] = { success: false, error: error.message };
    }
  }

  return results;
}

/**
 * 检查字体是否可用
 */
export function isFontLoaded(fontName) {
  return document.fonts.check(`12px "${fontName}"`);
}

/**
 * 获取字体加载状态
 */
export function getFontCache() {
  return Object.fromEntries(fontCache);
}
