<template>
  <div>
    <div class="loading-indicator" v-if="isLoading">加载中...</div>

    <select
      v-model="selectedRegion"
      @change="switchRegion"
      :disabled="isLoading"
    >
      <option v-for="region in regions" :key="region" :value="region">
        {{ region }}
      </option>
    </select>

    <div class="line-toggle">
      <label v-for="(visible, type) in lineVisibility" :key="type">
        <input
          type="checkbox"
          v-model="lineVisibility[type]"
          @change="toggleLine(type)"
          :disabled="isLoading"
        />
        {{ type }}
      </label>
    </div>

    <input
      type="file"
      accept="image/*"
      @change="onImageUpload"
      :disabled="isLoading"
      ref="fileInputRef"
    />
    <select
      v-model="selectedFont"
      @change="applySelectedFont"
      :disabled="isLoading"
    >
      <option v-for="font in fontOptions" :key="font.name" :value="font.name">
        {{ font.name }}
      </option>
    </select>

    <button @click="addText">添加文字</button>
    <button @click="exportDesign" :disabled="isLoading">导出 PDF</button>
    <button @click="downloadZip" :disabled="!zipDownloadUrl">下载 ZIP</button>
    <button v-if="isDev" @click="saveLocally" :disabled="isLoading">
      保存本地
    </button>

    <canvas ref="canvasEl" width="800" height="800"></canvas>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from "vue";
import { fabric } from "fabric";
import { loadSvgToCanvas } from "../utils/svgLoader";
import { loadCustomFont } from "../utils/fontLoader";

const fontOptions = [
  {
    name: "Roboto Condensed",
    url: `${
      import.meta.env.VITE_BACKEND_URL
    }/fonts/Roboto_Condensed-Regular.ttf`,
  },
  {
    name: "Source Han Serif SC",
    url: `${
      import.meta.env.VITE_BACKEND_URL
    }/fonts/SourceHanSerifSC-Regular.otf`,
  },
];

const selectedFont = ref("Roboto Condensed"); // 默认字体

// 🔧 添加一个变量来存储开发模式状态
const isDev = import.meta.env.DEV;

const canvas = ref(null);
const canvasEl = ref(null);
const fileInputRef = ref(null); // 🔧 新增：文件输入框的引用
const selectedRegion = ref("uv_01");
const regions = ["uv_01", "uv_02", "uv_03", "uv_04", "uv_05"];
const isLoading = ref(false);
const zipDownloadUrl = ref(null);

const lineVisibility = reactive({
  bleed: true,
  trim: true,
  safe: true,
  fold: true,
});

// 🔧 添加初始化状态追踪
const canvasReady = ref(false);
const loadingQueue = ref([]);

// 应用字体到当前选中文字对象
async function applySelectedFont() {
  const font = fontOptions.find((f) => f.name === selectedFont.value);
  if (!font) return;

  const success = await loadCustomFont(font.name, font.url);
  if (!success) {
    alert(`无法加载字体 ${font.name}`);
    return;
  }

  const activeObject = canvas.value?.getActiveObject();
  if (activeObject && activeObject.type === "text") {
    activeObject.set("fontFamily", font.name);
    canvas.value?.requestRenderAll();
  }
}

async function addText() {
  const fontMeta = fontOptions.find((f) => f.name === selectedFont.value);

  try {
    // 只有自定义字体才需要加载
    if (fontMeta && fontMeta.url) {
      const loadSuccess = await loadCustomFont(fontMeta.name, fontMeta.url);
      if (!loadSuccess) {
        alert(`字体 ${fontMeta.name} 加载失败，将使用默认字体`);
      }
    }

    const text = new fabric.Textbox("输入文字", {
      left: 100,
      top: 100,
      fontSize: 32,
      fontFamily: fontMeta?.name || "Arial", // 使用字体名称
      fill: "#000",
      editable: true, // ✅ 可编辑
      selectable: true, // ✅ 可选中
      evented: true, // ✅ 能响应事件（必须）
    });

    canvas.value.add(text);
    canvas.value.setActiveObject(text);
    canvas.value.renderAll();
  } catch (error) {
    console.error("添加文字失败:", error);
    alert("添加文字失败，请检查字体文件");
  }
}

function getUsedFonts(canvas) {
  const fonts = new Set();
  canvas.getObjects().forEach((obj) => {
    if (
      obj.type === "text" ||
      obj.type === "textbox" ||
      obj.type === "i-text"
    ) {
      if (obj.fontFamily) fonts.add(obj.fontFamily);
    }
  });
  return Array.from(fonts);
}

function resetFileInput() {
  if (fileInputRef.value) {
    fileInputRef.value.value = ""; // 清空文件输入框的值
  }
}

async function loadDesign(region) {
  try {
    const res = await fetch(`/template/${region}/design.json`);

    if (!res.ok) {
      console.warn(`设计文件不存在: /template/${region}/design.json`);
      return;
    }

    const json = await res.json();

    if (json.objects && json.objects.length > 0) {
      return new Promise((resolve) => {
        canvas.value.loadFromJSON(json, () => {
          console.log(`✅ 成功加载设计: ${region}`);
          canvas.value.renderAll();
          resolve();
        });
      });
    } else {
      canvas.value.renderAll();
    }
  } catch (error) {
    console.error(`加载设计失败: ${region}`, error);
  }
}

// 🔧 新增：完全重置画布状态的函数
function resetCanvasToInitialState() {
  if (!canvas.value) return;

  console.log("🔄 完全重置画布状态");

  // 移除所有事件监听器
  canvas.value.off();

  // 清空画布
  canvas.value.clear();

  // 重置所有变换
  canvas.value.setZoom(1);
  canvas.value.viewportTransform = [1, 0, 0, 1, 0, 0];
  canvas.value.setViewportTransform([1, 0, 0, 1, 0, 0]);

  // 重置画布属性
  canvas.value.relativePan(new fabric.Point(0, 0));

  // 清除缓存的变换信息
  delete canvas.value._originalViewTransform;

  // 强制重新渲染
  canvas.value.requestRenderAll();

  console.log("✅ 画布状态重置完成");
}

// 🔧 修复后的switchRegion函数 - 集成完全重置功能
async function switchRegion() {
  if (!canvas.value || !canvasReady.value) {
    console.warn("Canvas未准备好，延迟执行");
    loadingQueue.value.push(() => switchRegion());
    return;
  }

  isLoading.value = true;

  try {
    console.log(`🔄 切换区域: ${selectedRegion.value}`);

    // 🔧 完全重置画布状态
    resetCanvasToInitialState();
    resetFileInput(); // 💡 关键修改：重置文件输入框
    zipDownloadUrl.value = null; // 💡 关键修改：重置 ZIP 下载链接状态

    // 🔧 等待DOM更新
    await nextTick();

    // 🔧 重新绑定基础事件
    canvas.value.on("object:moving", (e) => {
      const obj = e.target;
      if (obj) {
        console.log("对象正在拖动:", obj.left, obj.top);
      }
    });

    canvas.value.on("mouse:dblclick", (e) => {
      const obj = e.target;
      if (obj && obj.type === "textbox") {
        console.log("双击 Textbox, 进入编辑模式");
        canvas.value.setActiveObject(obj);
        obj.enterEditing();
        obj.selectAll();
        canvas.value.renderAll();
      }
    });

    // 🔧 按顺序加载，确保每个步骤完成后再进行下一步
    console.log("📥 开始加载 uv_outline.svg");
    await loadSvgToCanvas(
      canvas.value,
      `/template/${selectedRegion.value}/uv_outline.svg`,
      "uv"
    );

    // 🔧 等待渲染完成
    await new Promise((resolve) => {
      canvas.value.renderAll();
      setTimeout(resolve, 100); // 给渲染一些时间
    });

    console.log("📥 开始加载 outlines.svg");
    await loadSvgToCanvas(
      canvas.value,
      `/template/${selectedRegion.value}/outlines.svg`,
      "guides"
    );

    // 🔧 等待渲染完成
    await new Promise((resolve) => {
      canvas.value.renderAll();
      setTimeout(resolve, 100);
    });

    // 🔧 应用线条可见性设置
    console.log("🎛️ 应用线条可见性设置");
    Object.keys(lineVisibility).forEach((type) => {
      toggleLine(type);
    });

    // 🔧 加载设计文件
    console.log("📥 加载设计文件");
    await loadDesign(selectedRegion.value);

    // 🔧 最终渲染
    canvas.value.renderAll();
    console.log("✅ 区域切换完成");
  } catch (error) {
    console.error("❌ 切换区域失败:", error);
  } finally {
    isLoading.value = false;
  }
}

function toggleLine(type) {
  if (!canvas.value) return;

  canvas.value.getObjects().forEach((obj) => {
    if (obj.customType === type) {
      obj.visible = lineVisibility[type];
    }
  });
  canvas.value.requestRenderAll();
}

// 🔧 修复后的图片导入函数
async function importImageToCanvas(file) {
  if (!canvas.value || isLoading.value) return;

  const clip = canvas.value
    .getObjects()
    .find((obj) => obj.customType === "uv_clipPath");

  const uvRawObjects = canvas.value
    .getObjects()
    .filter((obj) => obj.customType === "uv_raw");

  if (!clip || uvRawObjects.length === 0) {
    console.error("❌ 未找到合并的 UV 剪切路径或原始 UV 区域");
    return;
  }

  const combinedBounds = uvRawObjects.reduce(
    (acc, obj) => {
      const bounds = obj.getBoundingRect(true, true);
      acc.left = Math.min(acc.left, bounds.left);
      acc.top = Math.min(acc.top, bounds.top);
      acc.right = Math.max(acc.right, bounds.left + bounds.width);
      acc.bottom = Math.max(acc.bottom, bounds.top + bounds.height);
      return acc;
    },
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  );

  const regionOriginalLeft = combinedBounds.left;
  const regionOriginalTop = combinedBounds.top;
  const regionOriginalWidth = combinedBounds.right - combinedBounds.left;
  const regionOriginalHeight = combinedBounds.bottom - combinedBounds.top;

  console.log("📸 导入图片到画布");

  const clonedClipPath = fabric.util.object.clone(clip);

  clonedClipPath.set({
    absolutePositioned: true,
    left: regionOriginalLeft,
    top: regionOriginalTop,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    originX: "left",
    originY: "top",
  });

  const dataUrl = await resizeImage(file, 2048);

  return new Promise((resolve) => {
    fabric.Image.fromURL(dataUrl, (img) => {
      img.set({
        left: regionOriginalLeft,
        top: regionOriginalTop,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        clipPath: clonedClipPath,
        originX: "left",
        originY: "top",
        originalFileName: file.name,
        // 🔧 【关键新增】：保存原始文件引用，用于导出时获取高质量图片
        originalFile: file,
      });

      if (img.width && img.height) {
        const scaleX = regionOriginalWidth / img.width;
        const scaleY = regionOriginalHeight / img.height;
        const imgScale = Math.max(scaleX, scaleY);

        img.set({
          scaleX: imgScale,
          scaleY: imgScale,
        });

        const scaledImgWidth = img.getScaledWidth();
        const scaledImgHeight = img.getScaledHeight();

        img.set({
          left: regionOriginalLeft + (regionOriginalWidth - scaledImgWidth) / 2,
          top: regionOriginalTop + (regionOriginalHeight - scaledImgHeight) / 2,
        });
      }

      canvas.value.add(img);
      canvas.value.setActiveObject(img);
      canvas.value.requestRenderAll();
      resolve();
    });
  });
}

function onImageUpload(e) {
  const file = e.target.files[0];
  if (file) importImageToCanvas(file);
}

function resizeImage(file, maxSize = 2048) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvasEl = document.createElement("canvas");
      canvasEl.width = img.width * scale;
      canvasEl.height = img.height * scale;

      const ctx = canvasEl.getContext("2d");
      ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);

      resolve(canvasEl.toDataURL("image/jpeg", 0.85));
    };
    img.src = URL.createObjectURL(file);
  });
}

function addSizedSVGAttributes(svgText, width, height) {
  // 提取原始 <svg ...> 标签
  const svgTagMatch = svgText.match(/<svg[^>]*>/);
  if (!svgTagMatch) return svgText;

  // 清除 width / height / viewBox / xmlns 属性（无论顺序、缩进）
  const cleanedTag = svgTagMatch[0]
    .replace(/\swidth="[^"]*"/gi, "")
    .replace(/\sheight="[^"]*"/gi, "")
    .replace(/\sviewBox="[^"]*"/gi, "")
    .replace(/\sxmlns="[^"]*"/gi, "");

  // 注入干净的新属性
  const replacedTag = cleanedTag.replace(
    /^<svg/,
    `<svg width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"`
  );

  // 替换整个 <svg ...> 标签
  return svgText.replace(svgTagMatch[0], replacedTag);
}

// 目的：导出时使用原始质量的图片而非压缩后的预览图
async function getOriginalImageBlob(imgObj) {
  try {
    // 🔧 颜色修复方案：重新处理原始文件以统一色彩空间
    if (imgObj.originalFile) {
      console.log(`📷 处理原始文件: ${imgObj.originalFileName}`);

      // 🔧 关键修复：使用Canvas重新绘制以统一色彩空间
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          // 设置画布尺寸为原始图片尺寸
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          // 🔧 关键：强制使用sRGB色彩空间
          ctx.drawImage(img, 0, 0);

          // 转换为blob，强制JPEG格式和sRGB
          canvas.toBlob(
            (blob) => {
              console.log(`✅ 颜色空间统一完成: ${imgObj.originalFileName}`);
              resolve(blob);
            },
            "image/jpeg",
            0.95
          ); // 高质量JPEG
        };

        img.onerror = () => {
          console.warn("原始文件加载失败，使用备用方案");
          // fallback到当前显示的图片
          if (imgObj._element && imgObj._element.src) {
            fetch(imgObj._element.src)
              .then((res) => res.blob())
              .then(resolve);
          }
        };

        img.src = URL.createObjectURL(imgObj.originalFile);
      });
    }

    // 🔧 兜底方案：从当前显示的src获取（可能是压缩后的）
    if (imgObj._element && imgObj._element.src) {
      console.log(`📷 使用当前显示图片: ${imgObj.originalFileName}`);
      const response = await fetch(imgObj._element.src);
      return await response.blob();
    }

    throw new Error("无法获取图片数据");
  } catch (error) {
    console.error("获取图片数据失败:", error);
    // 最后的兜底：返回当前显示的图片数据
    const response = await fetch(imgObj._element.src);
    return await response.blob();
  }
}

async function exportDesign() {
  if (!canvas.value || isLoading.value) return;
  isLoading.value = true;

  // 🔧 重置下载链接，避免在新的导出开始时显示旧的链接
  zipDownloadUrl.value = null;

  try {
    const backupState = {
      zoom: canvas.value.getZoom(),
      viewportTransform: [...canvas.value.viewportTransform],
      originalViewTransform: canvas.value._originalViewTransform,
    };

    canvas.value.setZoom(1);
    canvas.value.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const { restore } = prepareExportObjects(canvas.value);

    canvas.value.requestRenderAll();
    const json = canvas.value.toDatalessJSON();

    restore();

    canvas.value.setZoom(backupState.zoom);
    canvas.value.setViewportTransform(backupState.viewportTransform);
    canvas.value._originalViewTransform = backupState.originalViewTransform;
    canvas.value.requestRenderAll();

    const tempCanvas = document.createElement("canvas");
    const clonedCanvas = new fabric.Canvas(tempCanvas, {
      width: canvas.value.getWidth(),
      height: canvas.value.getHeight(),
    });

    // 🔧 收集图片信息
    const imageFileNames = canvas.value
      .getObjects()
      .filter((obj) => obj.type === "image" && obj.originalFileName)
      .map((obj) => obj.originalFileName);

    console.log(`🔍 找到 ${imageFileNames.length} 个图片文件:`, imageFileNames);

    await new Promise((resolve) => {
      clonedCanvas.loadFromJSON(json, () => {
        clonedCanvas.renderAll();
        resolve();
      });
    });

    // 🔧 关键修复：计算实际内容边界
    const contentBounds = getCanvasContentBounds(clonedCanvas);

    // 💡 关键修改：生成字体样式
    const usedFontNames = getUsedFonts(clonedCanvas);
    const fontUrlMap = new Map(fontOptions.map((f) => [f.name, f.url]));
    const fontStyles = generateFontStylesForSVG(usedFontNames, fontUrlMap);

    // 🔧 生成原始SVG
    const originalSVG = clonedCanvas.toSVG({
      suppressPreamble: false,
      viewBox: {
        x: contentBounds.left,
        y: contentBounds.top,
        width: contentBounds.width,
        height: contentBounds.height,
      },
      width: contentBounds.width,
      height: contentBounds.height,
    });

    // 💡 关键修改：生成 SVG 后，直接调用 fixClipPathInSVGMarkup 函数
    let fixedSVG = fixClipPathInSVGMarkup(originalSVG);

    // 💡 关键修改：在 SVG 字符串中插入字体样式
    let finalSVG = fixedSVG;
    if (fontStyles) {
      finalSVG = finalSVG.replace(/<svg[^>]*>/, (match) => {
        return `${match}\n${fontStyles}`;
      });
    }
    let replacementCount = 0;

    imageFileNames.forEach((fileName, index) => {
      const relativePath = `images/${fileName}`;

      const base64Pattern = /href="data:image\/[^;]+;base64,[^"]*"/;
      const xlinkBase64Pattern = /xlink:href="data:image\/[^;]+;base64,[^"]*"/;

      if (base64Pattern.test(finalSVG)) {
        finalSVG = finalSVG.replace(base64Pattern, `href="${relativePath}"`);
        replacementCount++;
        console.log(
          `✅ 替换SVG图片 ${index + 1}: ${fileName} -> ${relativePath}`
        );
      } else if (xlinkBase64Pattern.test(finalSVG)) {
        finalSVG = finalSVG.replace(
          xlinkBase64Pattern,
          `xlink:href="${relativePath}"`
        );
        replacementCount++;
        console.log(
          `✅ 替换SVG图片 ${index + 1} (xlink): ${fileName} -> ${relativePath}`
        );
      }
    });

    // ✅ 加入 mm 单位 - 使用内容尺寸
    const finalSVGWithSize = addSizedSVGAttributes(
      finalSVG,
      contentBounds.width,
      contentBounds.height
    );

    // 🔧 【新增】处理JSON中的base64 - 关键修复
    console.log("🔧 开始处理JSON中的图片路径...");
    let processedJSON = JSON.stringify(json, null, 2);

    // 替换JSON中的base64图片数据
    imageFileNames.forEach((fileName, index) => {
      const relativePath = `images/${fileName}`;

      // 🔧 匹配JSON中的base64图片数据
      // JSON格式: "src":"data:image/jpeg;base64,..."
      const jsonBase64Pattern = /"src"\s*:\s*"data:image\/[^;]+;base64,[^"]*"/g;

      // 查找所有匹配项
      const matches = [...processedJSON.matchAll(jsonBase64Pattern)];
      console.log(`🔍 在JSON中找到 ${matches.length} 个base64图片引用`);

      if (matches.length > index) {
        // 替换第index个匹配项
        let currentIndex = 0;
        processedJSON = processedJSON.replace(jsonBase64Pattern, (match) => {
          if (currentIndex === index) {
            console.log(
              `✅ 替换JSON图片 ${index + 1}: ${fileName} -> ${relativePath}`
            );
            return `"src":"${relativePath}"`;
          }
          currentIndex++;
          return match;
        });
      }
    });

    // 🔧 验证JSON处理结果
    const jsonHasBase64 = processedJSON.includes("base64");
    const jsonHasImages = processedJSON.includes("images/");
    console.log(
      `🔍 JSON处理结果: 包含base64=${jsonHasBase64}, 包含images/=${jsonHasImages}`
    );

    clonedCanvas.dispose();

    const formData = new FormData();
    formData.append(
      "design",
      new Blob([finalSVGWithSize], { type: "image/svg+xml" }),
      "design.svg"
    );
    // 🔧 【关键修改】使用处理后的JSON
    formData.append(
      "json",
      new Blob([processedJSON], { type: "application/json" }),
      "data.json"
    );
    const previewBlob = await getPreviewBlob(canvas.value);
    formData.append("preview", previewBlob, "preview.png");

    // =========================================================
    // 💡 关键修改：处理并上传字体文件
    // =========================================================

    // 过滤出自定义字体，因为系统字体不需要上传
    const usedCustomFonts = fontOptions.filter((font) =>
      usedFontNames.includes(font.name)
    );

    console.log(
      `🔍 找到 ${usedCustomFonts.length} 个自定义字体文件:`,
      usedCustomFonts.map((f) => f.name)
    );

    // 遍历所有使用的自定义字体，以二进制形式上传
    for (const font of usedCustomFonts) {
      try {
        const response = await fetch(font.url);
        if (!response.ok) {
          throw new Error(`无法下载字体文件: ${font.url}`);
        }
        const fontBlob = await response.blob();
        const fontFileName = font.url.split("/").pop();

        // 使用 formData.append 上传字体文件
        formData.append("fonts", fontBlob, fontFileName);
        console.log(
          `📤 添加字体到导出: ${fontFileName}, 大小: ${fontBlob.size} bytes`
        );
      } catch (err) {
        console.error(`❌ 字体文件上传失败: ${font.name}`, err);
        // 如果某个字体上传失败，可以继续处理其他文件
      }
    }

    // 将使用的字体名称列表作为元数据上传
    formData.append("fontsUsed", JSON.stringify(usedFontNames));

    const images = canvas.value
      .getObjects()
      .filter((obj) => obj.type === "image" && obj.originalFileName);

    for (const imgObj of images) {
      const blob = await getOriginalImageBlob(imgObj);
      formData.append("images", blob, imgObj.originalFileName);
      console.log(
        `📤 添加图片到导出: ${imgObj.originalFileName}, 大小: ${blob.size} bytes`
      );
    }

    const res = await fetch("/api/export", {
      method: "POST",
      body: formData,
    });

    const text = await res.text();
    console.log("📥 服务器返回：", text);
    const result = JSON.parse(text);
    console.log("✅ 返回 JSON 结果：", result);

    if (result.success) {
      if (!result.usedCMYK) {
        alert(
          "⚠️ 当前导出为 RGB 模式，未成功转换为 CMYK。请联系管理员或重试。"
        );
      }
      // 🔧 存储 ZIP 下载链接
      zipDownloadUrl.value = getBackendUrl(result.download.zip);

      window.open(getBackendUrl(result.download.pdf), "_blank");
    } else {
      alert("导出失败，请检查服务器日志");
    }
  } catch (err) {
    console.error("导出失败：", err);
    alert("导出失败！");
  } finally {
    isLoading.value = false;
  }
}

// ✅ 新增：在 SVG 中嵌入 @font-face 样式的函数
function generateFontStylesForSVG(fontNames, fontUrlMap) {
  let fontStyles = "";
  for (const fontName of fontNames) {
    const fontUrl = fontUrlMap.get(fontName);
    // 只处理自定义字体
    if (fontUrl) {
      // ⚠️ 这里需要根据您的后端服务URL结构来构建正确的相对路径
      // 假设后端在处理时，会将字体文件放在一个 'fonts/' 目录下
      const fontFileName = fontUrl.split("/").pop();
      fontStyles += `
        @font-face {
          font-family: '${fontName}';
          src: url('fonts/${fontFileName}');
        }
      `;
    }
  }
  if (fontStyles) {
    return `<defs><style type="text/css">${fontStyles}</style></defs>`;
  }
  return "";
}

// 🔧 新增：下载 ZIP 文件的函数
function downloadZip() {
  if (zipDownloadUrl.value) {
    window.open(zipDownloadUrl.value, "_blank");
  }
}

async function saveLocally() {
  if (!canvas.value || isLoading.value) return;
  isLoading.value = true;

  try {
    const backupState = {
      zoom: canvas.value.getZoom(),
      viewportTransform: [...canvas.value.viewportTransform],
      originalViewTransform: canvas.value._originalViewTransform,
    };

    canvas.value.setZoom(1);
    canvas.value.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const { restore } = prepareExportObjects(canvas.value);

    canvas.value.requestRenderAll();

    const json = canvas.value.toDatalessJSON();

    // 🔧 关键修复：计算实际内容边界
    const contentBounds = getCanvasContentBounds(canvas.value);

    // 💡 关键修改：生成 SVG 前先获取字体列表
    const usedFontNames = getUsedFonts(clonedCanvas);
    const fontUrlMap = new Map(fontOptions.map((f) => [f.name, f.url]));
    const fontStyles = generateFontStylesForSVG(usedFontNames, fontUrlMap);

    const svg = canvas.value.toSVG({
      suppressPreamble: false,
      viewBox: {
        x: contentBounds.left,
        y: contentBounds.top,
        width: contentBounds.width,
        height: contentBounds.height,
      },
      width: contentBounds.width, // 🔧 关键：使用内容宽度
      height: contentBounds.height, // 🔧 关键：使用内容高度
      reviver: (markup, object) => {
        if (object.clipPath) {
          return fixClipPathInSVGMarkup(markup, object);
        }
        return markup;
      },
    });

    restore();

    canvas.value.setZoom(backupState.zoom);
    canvas.value.setViewportTransform(backupState.viewportTransform);
    canvas.value._originalViewTransform = backupState.originalViewTransform;
    canvas.value.requestRenderAll();

    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "design.svg");
    downloadBlob(
      new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }),
      "data.json"
    );
  } catch (error) {
    console.error("保存失败:", error);
    alert("保存失败！");
  } finally {
    isLoading.value = false;
  }
}

function getCanvasContentBounds(canvas) {
  // 获取所有可导出对象（排除辅助线、clipPath 等）
  const objects = canvas.getObjects().filter((obj) => {
    return (
      obj.visible !== false &&
      obj.excludeFromExport !== true &&
      obj.customType !== "guides" &&
      obj.type !== "clipPath"
    );
  });

  if (objects.length === 0) {
    return { left: 0, top: 0, width: 100, height: 100 };
  }

  // 初始边界
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  objects.forEach((obj) => {
    let bounds = obj.getBoundingRect(true, true);

    // ✅ 特别处理：如果是图片且带有 clipPath，限制最大边界
    if (
      obj.type === "image" &&
      obj.clipPath &&
      obj.clipPath.absolutePositioned
    ) {
      const clipBounds = obj.clipPath.getBoundingRect(true, true);

      // 限制图片边界为剪裁区域 ±30px（保留一些边缘余量）
      bounds = {
        left: clipBounds.left - 30,
        top: clipBounds.top - 30,
        width: clipBounds.width + 60,
        height: clipBounds.height + 60,
      };
    }

    const right = bounds.left + bounds.width;
    const bottom = bounds.top + bounds.height;

    if (bounds.left < minX) minX = bounds.left;
    if (bounds.top < minY) minY = bounds.top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  });

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    left: minX,
    top: minY,
    width,
    height,
  };
}

function prepareExportObjects(canvas) {
  const processedObjects = [];

  canvas.getObjects().forEach((obj) => {
    if (obj.type === "image" && obj.clipPath) {
      processedObjects.push({
        obj: obj,
        originalClipPath: obj.clipPath,
        originalClipSettings: {
          absolutePositioned: obj.clipPath.absolutePositioned,
          left: obj.clipPath.left,
          top: obj.clipPath.top,
          scaleX: obj.clipPath.scaleX,
          scaleY: obj.clipPath.scaleY,
          angle: obj.clipPath.angle,
          originX: obj.clipPath.originX,
          originY: obj.clipPath.originY,
        },
      });

      obj.setCoords(); // 强制刷新裁剪区域
    }
  });

  return {
    processedObjects,
    restore() {
      processedObjects.forEach(({ originalClipPath, originalClipSettings }) => {
        originalClipPath.set(originalClipSettings);
      });
    },
  };
}

function getBackendUrl(path) {
  return `${import.meta.env.VITE_BACKEND_URL}${path}`;
}

function getPreviewBlob(fabricCanvas) {
  return new Promise((resolve) => {
    const domCanvas = fabricCanvas.lowerCanvasEl;
    domCanvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      "image/png",
      1.0
    );
  });
}

function fixClipPathInSVGMarkup(markup) {
  // 🔧 修复 clipPath 的 transform 属性
  const clipPathRegex = /<clipPath[^>]*id="[^"]*"[^>]*>/g;
  let fixedMarkup = markup;

  // 🔧 移除 clipPath 中错误的 transform 属性
  fixedMarkup = fixedMarkup.replace(clipPathRegex, (match) => {
    return match.replace(/transform="[^"]*"/g, "");
  });

  // 🔧 确保 clipPath 内部的路径也没有错误的 transform
  const clipPathContentRegex = /<clipPath[^>]*>(.*?)<\/clipPath>/gs;
  fixedMarkup = fixedMarkup.replace(clipPathContentRegex, (match, content) => {
    // 移除 clipPath 内部路径的 transform 属性
    const fixedContent = content.replace(/transform="[^"]*"/g, "");
    return match.replace(content, fixedContent);
  });

  return fixedMarkup;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 🔧 处理延迟的加载队列
function processLoadingQueue() {
  while (loadingQueue.value.length > 0) {
    const task = loadingQueue.value.shift();
    task();
  }
}

onMounted(async () => {
  console.log("🚀 组件挂载开始");

  // 🔧 等待DOM完全准备好
  await nextTick();

  if (!canvasEl.value) {
    console.error("❌ Canvas元素未找到");
    return;
  }

  try {
    console.log("🎨 初始化Canvas");
    canvas.value = new fabric.Canvas(canvasEl.value, {
      // 🔧 添加一些稳定性配置
      renderOnAddRemove: true,
      skipTargetFind: false,
      perPixelTargetFind: false,

      // --- 关键修复：加入这些配置项 ---

      // 阻止浏览器的右键菜单，避免与事件冲突
      stopContextMenu: true,

      // 阻止默认的文本选择行为
      // 在某些浏览器中，双击会触发默认的文本选择，从而影响 Fabric.js 的事件
      allowTouchScrolling: false,

      // 启用此选项可以提高对象的可点击性
      interactive: true,
    });

    canvas.value.on("object:moving", (e) => {
      const obj = e.target;
      if (obj) {
        console.log("对象正在拖动:", obj.left, obj.top);
      }
    });

    canvas.value.on("mouse:dblclick", (e) => {
      const obj = e.target;
      if (obj && obj.type === "textbox") {
        console.log("双击 Textbox, 进入编辑模式");
        canvas.value.setActiveObject(obj);
        obj.enterEditing();
        obj.selectAll();
        canvas.value.renderAll();
      }
    });

    // 🔧 标记Canvas准备完成
    canvasReady.value = true;
    console.log("✅ Canvas初始化完成");

    // 🔧 处理延迟的任务
    processLoadingQueue();

    // 🔧 开始加载默认区域
    await switchRegion();
  } catch (error) {
    console.error("❌ Canvas初始化失败:", error);
  }
});
</script>

<style scoped>
.loading-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  z-index: 1000;
}

.line-toggle {
  display: flex;
  gap: 12px;
  margin: 10px 0;
}

canvas {
  border: 1px solid #ddd;
  background: white;
}

button:disabled,
input:disabled,
select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
