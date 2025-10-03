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

    <div class="border-toggle">
      <label>
        <input
          type="checkbox"
          v-model="showUVBorders"
          @change="toggleUVBorders"
          :disabled="isLoading"
        />
        显示UV区域边界
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

    <button @click="addText" :disabled="isLoading">添加文字</button>
    <button @click="exportMultipleRegions" :disabled="isLoading">
      分区域导出 PDF
    </button>
    <button @click="downloadZip" :disabled="!zipDownloadUrl">下载 ZIP</button>
    <button @click="resetView" :disabled="isLoading">重置视图</button>

    <div class="zoom-controls">
      <button @click="zoomOut" :disabled="isLoading">−</button>
      <input
        type="range"
        min="10"
        max="300"
        step="10"
        v-model.number="zoomLevel"
        @input="applyZoom"
        :disabled="isLoading"
      />
      <button @click="zoomIn" :disabled="isLoading">+</button>
      <span>{{ zoomLevel }}%</span>
    </div>

    <!-- 在模板中添加区域选择器 -->
    <div class="region-selector" v-if="availableRegions.length > 1">
      <label>选择图片放置区域:</label>
      <select v-model="selectedImageRegion">
        <option
          v-for="region in availableRegions"
          :key="region"
          :value="region"
        >
          {{ region }}
        </option>
      </select>
    </div>
    <canvas ref="canvasEl" width="800" height="800"></canvas>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from "vue";
import { fabric } from "fabric";
import { loadSvgToCanvas, getUVRegionIds } from "../utils/svgLoader";
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
  {
    name: "Artier EN",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/ArtierEN.ttf`,
  },
  {
    name: "Birthday Card",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/BirthdayCard.ttf`,
  },
  {
    name: "Bock Medium",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/Bock-Medium.ttf`,
  },
  {
    name: "Brush Up Life",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/BrushUpLife.ttf`,
  },
  {
    name: "Pencil",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/Pencil.ttf`,
  },
  {
    name: "Sounso Quality",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/Sounso-Quality.ttf`,
  },
  {
    name: "UNSII",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/UNSII.ttf`,
  },
  // ✅ 跨平台最保险的三种字体
  {
    name: "Arial",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/Arial.ttf`,
  },
  {
    name: "Times New Roman",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/TimesNewRoman.ttf`,
  },
  {
    name: "Courier New",
    url: `${import.meta.env.VITE_BACKEND_URL}/fonts/CourierNew.ttf`,
  },
];

const selectedFont = ref("Roboto Condensed"); // 默认字体

// 🔧 添加一个变量来存储开发模式状态
const isDev = import.meta.env.DEV;

const canvas = ref(null);
const canvasEl = ref(null);
const fileInputRef = ref(null); // 🔧 新增：文件输入框的引用
const selectedRegion = ref("uv_01");
const regions = ["uv_01", "uv_02", "uv_03"];
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

const zoomLevel = ref(0);
const initialZoom = ref(1);
const initialViewport = ref([1, 0, 0, 1, 0, 0]);

let isDragging = false;
let lastPosX = 0;
let lastPosY = 0;

const selectedImageRegion = ref("");
const availableRegions = ref([]);

const detectedDPI = ref(72); // 在组件顶部添加这个reactive变量
const showUVBorders = ref(true); // 默认显示边界

function toggleUVBorders() {
  if (!canvas.value) return;

  canvas.value.getObjects().forEach((obj) => {
    if (obj.customType === "uv_visualBorder") {
      obj.visible = showUVBorders.value;
    }
  });
  canvas.value.requestRenderAll();
}

// 🆕 获取可用的UV区域列表
function updateAvailableRegions() {
  if (!canvas.value) return;

  const regions = getUVRegionIds(canvas.value);
  availableRegions.value = regions;

  // 如果还没有选择区域且有可用区域，选择第一个
  if (!selectedImageRegion.value && regions.length > 0) {
    selectedImageRegion.value = regions[0];
  }
}

function enableCanvasDragging() {
  if (!canvas.value) return;

  canvas.value.on("mouse:down", function (opt) {
    const evt = opt.e;
    if (evt.altKey || evt.button === 1) {
      // 中键或按住 Alt 键开启拖动
      isDragging = true;
      canvas.value.selection = false;
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
    }
  });

  canvas.value.on("mouse:move", function (opt) {
    if (isDragging) {
      const e = opt.e;
      const vpt = canvas.value.viewportTransform;
      vpt[4] += e.clientX - lastPosX;
      vpt[5] += e.clientY - lastPosY;
      canvas.value.requestRenderAll();
      lastPosX = e.clientX;
      lastPosY = e.clientY;
    }
  });

  canvas.value.on("mouse:up", function () {
    isDragging = false;
    canvas.value.selection = true;
  });
}

function applyZoom() {
  if (!canvas.value) return;
  const zoomFactor = (zoomLevel.value || 100) / 100;
  canvas.value.setZoom(zoomFactor);
  canvas.value.setViewportTransform([zoomFactor, 0, 0, zoomFactor, 0, 0]);
  canvas.value.requestRenderAll();
}

function zoomIn() {
  if (zoomLevel.value < 300) {
    zoomLevel.value += 10;
    applyZoom();
  }
}

function zoomOut() {
  if (zoomLevel.value > 10) {
    zoomLevel.value -= 10;
    applyZoom();
  }
}

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

    const text = new fabric.Textbox("Input text", {
      left: 100,
      top: 100,
      fontSize: 32,
      fontFamily: fontMeta?.name || "Arial",
      fill: "#000",
      editable: true,
      selectable: true,
      evented: true,
      width: 200,
      minWidth: 100,
      splitByGrapheme: false,
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

    // 🆕 切换区域后更新可用区域列表
    await nextTick();
    updateAvailableRegions();

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

    // 🆕 检测原始SVG的DPI
    try {
      const svgResponse = await fetch(
        `/template/${selectedRegion.value}/uv_outline.svg`
      );
      const svgContent = await svgResponse.text();
      detectedDPI.value = detectSVGDPI(svgContent);
      console.log(
        `✅ 检测到区域 ${selectedRegion.value} 的DPI: ${detectedDPI.value}`
      );
    } catch (error) {
      console.warn("DPI检测失败，使用默认值:", error);
      detectedDPI.value = 72;
    }

    // 🔧 等待渲染完成
    await new Promise((resolve) => {
      canvas.value.renderAll();
      setTimeout(resolve, 100); // 给渲染一些时间
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

    // 💾 记录初始 zoom 和 viewportTransform
    initialZoom.value = canvas.value.getZoom();
    initialViewport.value = [...canvas.value.viewportTransform];

    // 👁️ 同步到 UI 的 zoom 滑块显示值
    zoomLevel.value = Math.round(initialZoom.value * 100);

    enableCanvasDragging();
  } catch (error) {
    console.error("❌ 切换区域失败:", error);
  } finally {
    isLoading.value = false;
  }
}

function resetView() {
  if (!canvas.value) return;

  canvas.value.setZoom(initialZoom.value);
  canvas.value.setViewportTransform([...initialViewport.value]);
  canvas.value.requestRenderAll();

  zoomLevel.value = Math.round(initialZoom.value * 100);
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

function onImageUpload(e) {
  const file = e.target.files[0];

  const input = e.target;

  if (file) {
    // 如果只有一个区域或用户没有选择，使用默认逻辑
    if (availableRegions.value.length <= 1 || !selectedImageRegion.value) {
      importImageToCanvas(file);
    } else {
      // 使用用户选择的区域
      importImageToSpecificRegion(file, selectedImageRegion.value);
    }
  }

  input.value = "";
}

async function processImageForEditing(
  file,
  maxSize = 1024,
  preserveOriginal = true
) {
  return new Promise(async (resolve) => {
    // 🔧 首先检测图片的色彩空间
    const colorInfo = await detectImageColorSpace(file);
    console.log("🎨 检测到的色彩信息:", colorInfo);

    const img = new Image();
    img.onload = () => {
      // 🔧 YCCK/CMYK 图片需要特殊处理
      if (colorInfo.isYCCK || colorInfo.isCMYK) {
        console.log("⚠️ 检测到CMYK/YCCK图片，将在后端进行专业处理");
        // 对于CMYK图片，我们传递原始文件给后端处理
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            compressed: reader.result,
            original: {
              file: file,
              width: img.naturalWidth || 2000, // 预估尺寸
              height: img.naturalHeight || 2000,
              name: file.name,
              size: file.size,
            },
            compressionRatio: 1.0,
            isHighQuality: true,
            needsCMYKProcessing: true, // 🔧 标记需要CMYK处理
            colorInfo: colorInfo,
          });
        };
        reader.readAsDataURL(file);
        return;
      }

      // RGB图片的正常处理逻辑...
      const needsCompression = img.width > maxSize || img.height > maxSize;

      if (!needsCompression && preserveOriginal) {
        // 🔧 小图片或高质量模式：直接使用原始图片
        console.log(
          `📷 图片尺寸适中(${img.width}x${img.height})，保持原始质量`
        );

        getOriginalImageDataUrl(file).then((originalDataUrl) => {
          resolve({
            compressed: originalDataUrl, // 实际上是原始图片
            original: {
              file: file,
              width: img.naturalWidth,
              height: img.naturalHeight,
              name: file.name,
              size: file.size,
            },
            compressionRatio: 1.0, // 无压缩
            isHighQuality: true,
          });
        });
        return;
      }

      // 🔧 需要压缩时，保持更高质量用于印刷品
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);

      const canvasEl = document.createElement("canvas");
      canvasEl.width = img.width * scale;
      canvasEl.height = img.height * scale;

      const ctx = canvasEl.getContext("2d");

      // 🔧 高质量重采样设置
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);

      // 🔧 印刷品使用更高质量的压缩
      const quality = 0.95; // 从0.8提升到0.95
      const compressedDataUrl = canvasEl.toDataURL("image/jpeg", quality);

      resolve({
        compressed: compressedDataUrl,
        original: {
          file: file,
          width: img.naturalWidth,
          height: img.naturalHeight,
          name: file.name,
          size: file.size,
        },
        compressionRatio: scale,
        isHighQuality: scale > 0.8, // 压缩比例不大时仍视为高质量
      });
    };
    img.src = URL.createObjectURL(file);
  });
}

// 🔧 新增：检测图片色彩空间
async function detectImageColorSpace(file) {
  // 这里可以通过读取文件头信息来快速检测
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      const uint8Array = new Uint8Array(arrayBuffer);

      // 检查JPEG文件的APP标记段
      let isYCCK = false;
      let isCMYK = false;

      // 简单的JPEG标记检测
      for (let i = 0; i < uint8Array.length - 4; i++) {
        if (uint8Array[i] === 0xff && uint8Array[i + 1] === 0xee) {
          // Adobe APP14 marker - 可能包含色彩信息
          const colorTransform = uint8Array[i + 11];
          if (colorTransform === 2) {
            isYCCK = true;
            isCMYK = true;
          } else if (colorTransform === 0) {
            isCMYK = true;
          }
          break;
        }
      }

      resolve({ isYCCK, isCMYK });
    };
    reader.readAsArrayBuffer(file.slice(0, 2048)); // 只读取前2KB检测
  });
}

// 🔧 新增：获取原始图片的 Data URL
function getOriginalImageDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function detectSVGDPI(svgContent, knownPhysicalSize = null) {
  console.log("🔍 开始检测SVG DPI...");

  // 1. 提取viewBox
  const viewBoxMatch = svgContent.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!viewBoxMatch) {
    console.warn("❌ 未找到viewBox，无法检测DPI");
    return 72;
  }

  const [x, y, vbWidth, vbHeight] = viewBoxMatch[1]
    .split(/\s+/)
    .map(parseFloat);
  console.log(`🔍 ViewBox: ${vbWidth} x ${vbHeight}`);

  // 2. 尝试从SVG属性获取物理尺寸
  const widthMatch = svgContent.match(/width\s*=\s*["']([^"']+)["']/);
  const heightMatch = svgContent.match(/height\s*=\s*["']([^"']+)["']/);

  if (widthMatch && heightMatch) {
    const widthStr = widthMatch[1];
    const heightStr = heightMatch[1];
    const widthValue = parseFloat(widthStr);
    const heightValue = parseFloat(heightStr);
    const widthUnit = widthStr.match(/[a-zA-Z%]+$/)?.[0];
    const heightUnit = heightStr.match(/[a-zA-Z%]+$/)?.[0];

    console.log(
      `🔍 SVG尺寸: ${widthValue}${widthUnit} x ${heightValue}${heightUnit}`
    );

    // 处理英寸单位
    if (
      widthUnit === "in" &&
      heightUnit === "in" &&
      widthValue > 0 &&
      heightValue > 0
    ) {
      const dpiX = vbWidth / widthValue;
      const dpiY = vbHeight / heightValue;
      const avgDPI = Math.round((dpiX + dpiY) / 2);

      console.log(
        `✅ 从英寸单位检测到DPI: ${avgDPI} (X: ${dpiX.toFixed(
          1
        )}, Y: ${dpiY.toFixed(1)})`
      );
      return avgDPI;
    }

    // 处理毫米单位
    if (
      widthUnit === "mm" &&
      heightUnit === "mm" &&
      widthValue > 0 &&
      heightValue > 0
    ) {
      const inchWidth = widthValue / 25.4;
      const inchHeight = heightValue / 25.4;
      const dpiX = vbWidth / inchWidth;
      const dpiY = vbHeight / inchHeight;
      const avgDPI = Math.round((dpiX + dpiY) / 2);

      console.log(
        `✅ 从毫米单位检测到DPI: ${avgDPI} (物理尺寸: ${inchWidth.toFixed(
          2
        )}" x ${inchHeight.toFixed(2)}")`
      );
      return avgDPI;
    }

    // 处理厘米单位（tradeshow产品常用）
    if (
      widthUnit === "cm" &&
      heightUnit === "cm" &&
      widthValue > 0 &&
      heightValue > 0
    ) {
      const inchWidth = widthValue / 2.54;
      const inchHeight = heightValue / 2.54;
      const dpiX = vbWidth / inchWidth;
      const dpiY = vbHeight / inchHeight;
      const avgDPI = Math.round((dpiX + dpiY) / 2);

      console.log(
        `✅ 从厘米单位检测到DPI: ${avgDPI} (物理尺寸: ${inchWidth.toFixed(
          2
        )}" x ${inchHeight.toFixed(2)}")`
      );
      return avgDPI;
    }

    // 处理像素单位但已知物理尺寸
    if ((widthUnit === "px" || !widthUnit) && knownPhysicalSize) {
      const dpiX = vbWidth / knownPhysicalSize.width;
      const dpiY = vbHeight / knownPhysicalSize.height;
      const avgDPI = Math.round((dpiX + dpiY) / 2);

      console.log(`✅ 从已知物理尺寸计算DPI: ${avgDPI}`);
      return avgDPI;
    }
  }

  // 3. 🔧 基于ViewBox尺寸的智能推断（适用于大型tradeshow产品）
  const totalPixels = vbWidth * vbHeight;
  const maxDimension = Math.max(vbWidth, vbHeight);

  console.log(
    `🔍 ViewBox分析: 最大尺寸=${maxDimension}px, 总像素=${totalPixels}`
  );

  // 🔧 针对大型展示产品的DPI推断
  if (maxDimension > 5000) {
    console.log(`🏗️ 大型展示产品尺寸(${maxDimension}px)，推断高分辨率DPI: 300`);
    return 72;
  } else if (maxDimension > 2000) {
    console.log(`🏗️ 中型展示产品尺寸(${maxDimension}px)，推断中等DPI: 150`);
    return 72;
  } else if (maxDimension > 1000) {
    console.log(`🏗️ 标准展示产品尺寸(${maxDimension}px)，推断标准DPI: 72`);
    return 72;
  } else {
    console.log(`🏗️ 小型产品或图标尺寸(${maxDimension}px)，推断高DPI: 300`);
    return 72; // 小尺寸可能是高分辨率的小部件
  }
}

function addSizedSVGAttributes(
  svgText,
  width,
  height,
  unit = "in",
  sourceDPI = null
) {
  const svgTagMatch = svgText.match(/<svg[^>]*>/);
  if (!svgTagMatch) return svgText;

  // 🔧 如果没有提供DPI，尝试自动检测
  let actualDPI = sourceDPI;
  if (!actualDPI) {
    // 这里可以传入原始模板信息来检测，或使用默认值
    actualDPI = 72; // 或者调用 detectSVGDPI
    console.log(`🔍 使用DPI: ${actualDPI}`);
  }

  let finalWidth = width;
  let finalHeight = height;

  if (unit === "in") {
    finalWidth = (width / actualDPI).toFixed(4);
    finalHeight = (height / actualDPI).toFixed(4);
  } else if (unit === "mm") {
    finalWidth = ((width / actualDPI) * 25.4).toFixed(4);
    finalHeight = ((height / actualDPI) * 25.4).toFixed(4);
  }

  const cleanedTag = svgTagMatch[0]
    .replace(/\swidth="[^"]*"/gi, "")
    .replace(/\sheight="[^"]*"/gi, "")
    .replace(/\sviewBox="[^"]*"/gi, "")
    .replace(/\sxmlns="[^"]*"/gi, "");

  const replacedTag = cleanedTag.replace(
    /^<svg/,
    `<svg width="${finalWidth}${unit}" height="${finalHeight}${unit}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"`
  );

  return svgText.replace(svgTagMatch[0], replacedTag);
}

// 目的：导出时使用原始质量的图片而非压缩后的预览图
async function getOriginalImageBlob(imgObj) {
  try {
    // 🔧 优先使用原始文件
    if (imgObj.originalFile) {
      console.log(
        `📁 使用原始文件: ${imgObj.originalFileName} (${(
          imgObj.originalFile.size /
          1024 /
          1024
        ).toFixed(2)}MB)`
      );

      // 直接返回原始文件的blob，不进行任何处理
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const arrayBuffer = reader.result;
          const blob = new Blob([arrayBuffer], {
            type: imgObj.originalFile.type,
          });
          console.log(`✅ 原始文件blob创建成功: ${imgObj.originalFileName}`);
          resolve(blob);
        };
        reader.readAsArrayBuffer(imgObj.originalFile);
      });
    }

    // 备用方案：从当前显示的src获取
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

// 分页导出
// 🆕 新增：分区域导出函数
async function exportMultipleRegions() {
  if (!canvas.value || isLoading.value) return;
  isLoading.value = true;

  // 重置下载链接
  zipDownloadUrl.value = null;

  try {
    // 🔧 提前备份状态，避免视觉异常
    const backupState = {
      zoom: canvas.value.getZoom(),
      viewportTransform: [...canvas.value.viewportTransform],
      originalViewTransform: canvas.value._originalViewTransform,
    };

    // 获取所有UV区域ID
    const uvRegionIds = getUVRegionIds(canvas.value);
    console.log(`🔍 找到 ${uvRegionIds.length} 个UV区域:`, uvRegionIds);

    if (uvRegionIds.length === 0) {
      alert("未找到UV区域，无法分区域导出");
      return;
    }

    // 🆕 为每个UV区域生成独立的设计数据
    const regionExports = [];

    for (const regionId of uvRegionIds) {
      console.log(`📤 处理区域: ${regionId}`);

      // 🔧 临时修改画布状态，立即恢复
      canvas.value.setZoom(1);
      canvas.value.setViewportTransform([1, 0, 0, 1, 0, 0]);

      const { restore } = prepareExportObjects(canvas.value);
      canvas.value.requestRenderAll();

      // 获取该区域相关的所有对象
      const regionObjects = getObjectsForRegion(canvas.value, regionId);

      // 🔧 立即恢复状态，减少视觉异常时间
      restore();
      canvas.value.setZoom(backupState.zoom);
      canvas.value.setViewportTransform(backupState.viewportTransform);
      canvas.value._originalViewTransform = backupState.originalViewTransform;
      canvas.value.requestRenderAll();

      // 创建该区域的临时画布
      const tempCanvas = document.createElement("canvas");
      const regionCanvas = new fabric.Canvas(tempCanvas, {
        width: canvas.value.getWidth(),
        height: canvas.value.getHeight(),
      });

      // 将对象添加到区域画布
      const regionJson = {
        objects: regionObjects,
        backgroundImage: null,
      };

      await new Promise((resolve) => {
        regionCanvas.loadFromJSON(regionJson, () => {
          regionCanvas.renderAll();
          resolve();
        });
      });

      // 🔧 建议添加这一行，等待渲染完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 🔧 新增：调试画布裁剪问题
      debugCanvasClipping(regionCanvas, regionId);

      // 计算该区域的内容边界
      const contentBounds = getCanvasContentBounds(regionCanvas);
      console.log(`🔍 区域 ${regionId} 最终边界:`, contentBounds);

      // 生成该区域的SVG
      const usedFontNames = getUsedFonts(regionCanvas);
      const fontUrlMap = new Map(fontOptions.map((f) => [f.name, f.url]));
      const fontStyles = generateFontStylesForSVG(usedFontNames, fontUrlMap);

      const originalSVG = regionCanvas.toSVG({
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

      let fixedSVG = fixClipPathInSVGMarkup(originalSVG);
      if (fontStyles) {
        fixedSVG = fixedSVG.replace(/<svg[^>]*>/, (match) => {
          return `${match}\n${fontStyles}`;
        });
      }

      // 处理图片路径
      const imageFileNames = regionCanvas
        .getObjects()
        .filter((obj) => obj.type === "image" && obj.originalFileName)
        .map((obj) => obj.originalFileName);

      let finalSVG = fixedSVG;
      imageFileNames.forEach((fileName) => {
        const imgObj = regionCanvas
          .getObjects()
          .find(
            (obj) => obj.type === "image" && obj.originalFileName === fileName
          );

        // 🔧 关键修改：对于CMYK图片，应该引用jpgicc处理后的RGB版本
        let imagePath;
        if (
          imgObj &&
          (imgObj.needsCMYKProcessing ||
            imgObj.compressionInfo?.wasCMYKImage ||
            (imgObj.compressionInfo && imgObj.compressionInfo.isHighQuality))
        ) {
          // 使用处理后的版本（jpgicc转换的RGB图片）
          imagePath = `../images/${fileName}`;
          console.log(`🔧 使用处理后版本: ${fileName}`);
        } else {
          // 使用原始版本
          imagePath = `../images/originals/${fileName}`;
          console.log(`📷 使用原始版本: ${fileName}`);
        }

        // 🔧 简化判断：直接检查文件是否是CMYK转换的 //临时方案
        imagePath = `../images/${fileName}`; // 🔧 强制使用处理后的版本
        console.log(`🔧 强制使用处理后版本: ${fileName}`);

        const base64Pattern = /href="data:image\/[^;]+;base64,[^"]*"/;
        const xlinkBase64Pattern =
          /xlink:href="data:image\/[^;]+;base64,[^"]*"/;

        if (base64Pattern.test(finalSVG)) {
          finalSVG = finalSVG.replace(base64Pattern, `href="${imagePath}"`);
        } else if (xlinkBase64Pattern.test(finalSVG)) {
          finalSVG = finalSVG.replace(
            xlinkBase64Pattern,
            `xlink:href="${imagePath}"`
          );
        }
      });

      const finalSVGWithSize = addSizedSVGAttributes(
        finalSVG,
        contentBounds.width,
        contentBounds.height,
        "in",
        detectedDPI.value
      );

      // 添加这一行：
      const centeredSVG = fixSVGViewBoxCentering(
        finalSVGWithSize,
        contentBounds,
        { width: contentBounds.width, height: contentBounds.height }
      );

      // 生成该区域的JSON
      const regionJsonData = JSON.stringify(regionJson, null, 2);

      // 处理JSON中的图片路径
      let processedJSON = regionJsonData;
      imageFileNames.forEach((fileName) => {
        // 🔧 修改：使用相同的智能路径选择逻辑
        const imgObj = regionCanvas
          .getObjects()
          .find(
            (obj) => obj.type === "image" && obj.originalFileName === fileName
          );

        let imagePath;

        // 🔧 修改：优先检查是否是CMYK处理的图片
        if (
          imgObj &&
          (imgObj.needsCMYKProcessing ||
            imgObj.compressionInfo?.wasCMYKImage ||
            (imgObj.compressionInfo && imgObj.compressionInfo.isHighQuality))
        ) {
          // 使用处理后的版本（jpgicc转换的RGB图片）
          imagePath = `../images/${fileName}`;
          console.log(`📋 JSON使用高质量处理版本: ${fileName}`);
        } else {
          // 使用原始版本
          imagePath = `../images/originals/${fileName}`;
          console.log(`📋 JSON使用原始版本保证印刷质量: ${fileName}`);
        }

        // 🔧 JSON中也强制使用处理后版本 //临时方案
        imagePath = `../images/${fileName}`;
        console.log(`🔧 JSON强制使用处理后版本: ${fileName}`);

        const jsonBase64Pattern =
          /"src"\s*:\s*"data:image\/[^;]+;base64,[^"]*"/g;
        processedJSON = processedJSON.replace(
          jsonBase64Pattern,
          `"src":"${imagePath}"`
        );
      });

      regionExports.push({
        regionId,
        svg: centeredSVG, // 使用居中修复后的SVG
        json: processedJSON,
        imageFileNames,
        usedFontNames,
        contentBounds,
      });

      regionCanvas.dispose();
    }

    // 🔧 最终发送请求，此时画布状态已经正常
    await sendMultiRegionExportRequest(regionExports);
  } catch (err) {
    console.error("分区域导出失败：", err);
    alert("分区域导出失败！");
  } finally {
    isLoading.value = false;
    // 🔧 确保画布状态正常
    if (canvas.value) {
      canvas.value.requestRenderAll();
    }
  }
}

// 🆕 获取指定区域的所有相关对象
function getObjectsForRegion(canvas, regionId) {
  const objects = [];

  canvas.getObjects().forEach((obj) => {
    // 包含该区域的边界对象
    if (obj.uvRegionId === regionId && obj.customType === "uv_boundary") {
      objects.push(obj.toJSON());
    }
    // 包含位于该区域内的用户对象（图片、文字等）
    else if (
      obj.type === "image" ||
      obj.type === "text" ||
      obj.type === "textbox"
    ) {
      if (isObjectInRegion(canvas, obj, regionId)) {
        // 需要保留原始文件信息，但序列化时会丢失，所以单独处理
        const objData = obj.toJSON();
        if (obj.originalFileName) {
          objData.originalFileName = obj.originalFileName;
        }
        objects.push(objData);
      }
    }
    // 🔧 修改辅助线处理逻辑，检查导出状态
    else if (
      obj.customType &&
      (obj.customType.includes("bleed") ||
        obj.customType.includes("trim") ||
        obj.customType.includes("safe"))
    ) {
      // 🔧 只有在没有被排除导出且在区域内时才包含
      if (
        obj.excludeFromExport !== true &&
        isObjectInRegion(canvas, obj, regionId)
      ) {
        objects.push(obj.toJSON());
      }
    }
  });

  return objects;
}

// 🆕 判断对象是否在指定区域内
function isObjectInRegion(canvas, obj, regionId) {
  // 🔧 如果对象本身就标记了所属区域，直接返回
  if (obj.uvRegionId === regionId) {
    return true;
  }

  // 🔧 获取该区域的边界对象
  const regionBoundary = canvas
    .getObjects()
    .find(
      (boundaryObj) =>
        boundaryObj.uvRegionId === regionId &&
        boundaryObj.customType === "uv_boundary"
    );

  if (!regionBoundary) {
    console.warn(`⚠️ 未找到区域 ${regionId} 的边界对象`);
    return false;
  }

  // 🔧 改进的边界检测：检查对象的包围盒是否与区域有交集
  const objBounds = obj.getBoundingRect(true, true);
  const regionBounds = regionBoundary.getBoundingRect(true, true);

  // 检查两个矩形是否有交集
  const hasIntersection = !(
    objBounds.left > regionBounds.left + regionBounds.width ||
    objBounds.left + objBounds.width < regionBounds.left ||
    objBounds.top > regionBounds.top + regionBounds.height ||
    objBounds.top + objBounds.height < regionBounds.top
  );

  // 🔧 如果有交集，进一步检查对象中心点是否在区域内
  if (hasIntersection) {
    const objCenter = obj.getCenterPoint();
    const isInside =
      objCenter.x >= regionBounds.left &&
      objCenter.x <= regionBounds.left + regionBounds.width &&
      objCenter.y >= regionBounds.top &&
      objCenter.y <= regionBounds.top + regionBounds.height;

    console.log(`🔍 对象 ${obj.type} 在区域 ${regionId} 中: ${isInside}`, {
      objCenter,
      regionBounds,
      hasIntersection,
    });

    return isInside;
  }

  return false;
}

// 🆕 完整的指定区域图片导入函数
async function importImageToSpecificRegion(file, regionId) {
  if (!canvas.value || isLoading.value) return;

  console.log(
    `🖼️ 处理图片: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`
  );

  // 🔧 根据文件大小和用途决定处理策略
  const isLargeFile = file.size > 5 * 1024 * 1024; // 5MB以上
  const maxEditingSize = isLargeFile ? 2048 : 4096; // 大文件用2K，小文件用4K编辑

  const processedImage = await processImageForEditing(
    file,
    maxEditingSize,
    !isLargeFile // 小文件保持原始质量
  );

  console.log(
    `📊 处理结果: 压缩比${(processedImage.compressionRatio * 100).toFixed(
      1
    )}%, 高质量:${processedImage.isHighQuality}`
  );

  // 🔧 查找指定区域的clipPath
  const selectedClipPath = canvas.value
    .getObjects()
    .find(
      (obj) => obj.customType === "uv_clipPath" && obj.uvRegionId === regionId
    );

  if (!selectedClipPath) {
    console.error(`❌ 未找到区域 ${regionId} 的剪切路径`);
    alert(`未找到区域 ${regionId}，请确认区域存在`);
    return;
  }

  // 🔧 获取该区域的原始UV对象来计算边界
  const regionUvObjects = canvas.value
    .getObjects()
    .filter(
      (obj) => obj.customType === "uv_raw" && obj.uvRegionId === regionId
    );

  if (regionUvObjects.length === 0) {
    console.error(`❌ 未找到区域 ${regionId} 的原始UV对象`);
    alert(`区域 ${regionId} 数据不完整`);
    return;
  }

  // 🔧 计算该区域的边界
  const combinedBounds = regionUvObjects.reduce(
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

  console.log(`📸 导入图片到区域 ${regionId}`, {
    left: regionOriginalLeft,
    top: regionOriginalTop,
    width: regionOriginalWidth,
    height: regionOriginalHeight,
  });

  // 🔧 克隆指定区域的clipPath
  const clonedClipPath = fabric.util.object.clone(selectedClipPath);

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

  return new Promise((resolve) => {
    fabric.Image.fromURL(processedImage.compressed, (img) => {
      img.set({
        left: regionOriginalLeft,
        top: regionOriginalTop,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        clipPath: clonedClipPath,
        originX: "left",
        originY: "top",

        // 🔧 增强的原始文件信息
        originalFileName: file.name,
        originalFile: file,
        originalDimensions: {
          width: processedImage.original.width,
          height: processedImage.original.height,
        },
        compressionInfo: {
          ratio: processedImage.compressionRatio,
          isHighQuality: processedImage.isHighQuality,
          compressedForEditing: processedImage.compressionRatio < 1.0,
        },

        // 🔧 新增：传递CMYK处理标记
        needsCMYKProcessing: processedImage.needsCMYKProcessing || false,
        colorInfo: processedImage.colorInfo,

        uvRegionId: regionId,
      });

      // 缩放逻辑保持不变
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

      console.log(`✅ 图片成功导入到区域 ${regionId} (使用压缩版本进行编辑)`);
      resolve();
    });
  });
}

async function importImageToCanvas(file) {
  if (!canvas.value || isLoading.value) return;

  // 🔧 获取所有UV区域的clipPath
  const uvClipPaths = canvas.value
    .getObjects()
    .filter((obj) => obj.customType === "uv_clipPath");

  if (uvClipPaths.length === 0) {
    console.error("❌ 未找到任何 UV 剪切路径");
    alert("未找到可用的UV区域");
    return;
  }

  console.log(`🔍 找到 ${uvClipPaths.length} 个UV剪切路径`);

  // 🔧 选择要使用的区域
  let selectedRegionId;

  if (uvClipPaths.length === 1) {
    // 只有一个区域，直接使用
    selectedRegionId = uvClipPaths[0].uvRegionId;
    console.log(`📍 自动选择唯一的UV区域: ${selectedRegionId}`);
  } else {
    // 🔧 直接弹窗选择，不检查 selectedImageRegion.value
    const regionChoice = prompt(
      `请选择要放置图片的区域:\n${uvClipPaths
        .map((cp, i) => `${i}: ${cp.uvRegionId}`)
        .join("\n")}`
    );

    if (regionChoice !== null) {
      const index = parseInt(regionChoice);
      if (index >= 0 && index < uvClipPaths.length) {
        selectedRegionId = uvClipPaths[index].uvRegionId;
      } else {
        alert(`无效的选择`);
        return;
      }
    } else {
      return;
    }
  }

  if (!selectedRegionId) {
    console.error("❌ 未能确定目标区域");
    return;
  }

  // 🔧 调用指定区域导入函数
  return importImageToSpecificRegion(file, selectedRegionId);
}

// 🆕 发送多区域导出请求
async function sendMultiRegionExportRequest(regionExports) {
  const formData = new FormData();

  // 添加区域数量信息
  formData.append("exportType", "multiRegion");
  formData.append("regionCount", regionExports.length.toString());

  // 🔧 仅新增这两行：
  formData.append("detectedDPI", detectedDPI.value.toString());
  formData.append("sourceRegion", selectedRegion.value);

  // 为每个区域添加文件
  regionExports.forEach((regionData, index) => {
    formData.append(
      `region_${index}_svg`,
      new Blob([regionData.svg], { type: "image/svg+xml" }),
      `${regionData.regionId}.svg`
    );
    formData.append(
      `region_${index}_json`,
      new Blob([regionData.json], { type: "application/json" }),
      `${regionData.regionId}.json`
    );
    formData.append(`region_${index}_id`, regionData.regionId);
  });

  // 添加预览图
  const previewBlob = await getPreviewBlob(canvas.value);
  formData.append("preview", previewBlob, "preview.png");

  // 收集并添加所有使用的图片（去重）
  const allImageFileNames = [
    ...new Set(regionExports.flatMap((r) => r.imageFileNames)),
  ];
  const images = canvas.value
    .getObjects()
    .filter((obj) => obj.type === "image" && obj.originalFileName);

  for (const imgObj of images) {
    if (allImageFileNames.includes(imgObj.originalFileName)) {
      const blob = await getOriginalImageBlob(imgObj);
      formData.append("images", blob, imgObj.originalFileName);
    }
  }

  // 收集并添加所有使用的字体（去重）
  const allUsedFontNames = [
    ...new Set(regionExports.flatMap((r) => r.usedFontNames)),
  ];
  const usedCustomFonts = fontOptions.filter((font) =>
    allUsedFontNames.includes(font.name)
  );

  for (const font of usedCustomFonts) {
    try {
      const response = await fetch(font.url);
      if (response.ok) {
        const fontBlob = await response.blob();
        const fontFileName = font.url.split("/").pop();
        formData.append("fonts", fontBlob, fontFileName);
      }
    } catch (err) {
      console.error(`字体文件上传失败: ${font.name}`, err);
    }
  }

  formData.append("fontsUsed", JSON.stringify(allUsedFontNames));

  // 发送请求
  const res = await fetch("/api/export", {
    method: "POST",
    body: formData,
  });

  const result = JSON.parse(await res.text());

  if (result.success) {
    zipDownloadUrl.value = getBackendUrl(result.download.zip);

    // 🔧 增强显示验证信息
    let alertMessage = `✅ 成功生成 ${regionExports.length} 个区域的PDF文件！`;

    // 显示像素级验证结果
    if (result.pixelValidation) {
      alertMessage += `\n🎨 色彩验证: ${result.pixelValidation.colorSpace}色彩空间`;
      alertMessage += `\n🔬 像素分析: ${result.pixelValidation.samplePixel}`;

      if (result.pixelValidation.colorSpace === "CMYK") {
        alertMessage += `\n✅ CMYK转换成功，可用于专业印刷`;
      }
    } else if (result.validatedColorSpace) {
      alertMessage += `\n🎨 验证结果: ${result.validatedColorSpace}`;
      if (result.validationConfidence) {
        alertMessage += ` (置信度: ${(
          result.validationConfidence * 100
        ).toFixed(1)}%)`;
      }
    }

    alert(alertMessage);
  }
}
// 分页导出

// 🔧 更精确的环境和平台判断
function generateFontStylesForSVG(fontNames, fontUrlMap) {
  const isProduction = import.meta.env.PROD;
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  // 判断是否为生产环境的Linux服务器
  const isProductionLinux = isProduction && backendUrl.includes("duckdns.org");

  if (isProductionLinux) {
    console.log("🏭 生产环境Linux：使用系统字体");
    return "";
  } else {
    console.log("💻 开发环境或其他：使用网络字体");

    let fontStyles = "";
    for (const fontName of fontNames) {
      const fontUrl = fontUrlMap.get(fontName);
      if (fontUrl) {
        const fontFileName = fontUrl.split("/").pop();
        fontStyles += `
        @font-face {
          font-family: '${fontName}';
          src: url('../fonts/${fontFileName}');
        }
      `;
      }
    }
    if (fontStyles) {
      return `<defs><style type="text/css">${fontStyles}</style></defs>`;
    }
    return "";
  }
}

// 🔧 新增：下载 ZIP 文件的函数
function downloadZip() {
  if (zipDownloadUrl.value) {
    window.open(zipDownloadUrl.value, "_blank");
  }
}

// 1. 修改 calculateBoundsFromObjects 函数，改进图片clipPath边界计算
function calculateBoundsFromObjects(objects) {
  console.log(`🔍 计算 ${objects.length} 个对象的边界...`);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  objects.forEach((obj, index) => {
    // 🔧 关键修复：获取对象的真实边界，忽略画布变换
    let bounds;

    const canvas = obj.canvas;
    let originalVpt = null;
    if (canvas) {
      originalVpt = [...canvas.viewportTransform];
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    }

    bounds = obj.getBoundingRect(false, false);

    if (canvas && originalVpt) {
      canvas.setViewportTransform(originalVpt);
    }

    // 🔧 调试每个对象的边界
    console.log(`  对象 ${index} (${obj.type || obj.customType}):`, bounds);

    // 🔧 关键修复：改进图片clipPath边界计算
    if (obj.type === "image" && obj.clipPath) {
      let clipBounds;

      // 获取clipPath的边界
      if (obj.clipPath.absolutePositioned) {
        clipBounds = obj.clipPath.getBoundingRect(false, false);
      } else {
        // 如果clipPath不是绝对定位，需要相对于图片计算
        clipBounds = obj.clipPath.getBoundingRect(false, false);
        clipBounds.left += obj.left;
        clipBounds.top += obj.top;
      }

      console.log(`  图片clipPath原始边界:`, clipBounds);

      // 🔧 不添加额外边距，直接使用clipPath边界
      bounds = {
        left: clipBounds.left,
        top: clipBounds.top,
        width: clipBounds.width,
        height: clipBounds.height,
      };

      console.log(`  图片clipPath最终边界:`, bounds);
    }

    const right = bounds.left + bounds.width;
    const bottom = bounds.top + bounds.height;

    if (bounds.left < minX) minX = bounds.left;
    if (bounds.top < minY) minY = bounds.top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  });

  const result = {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  console.log(
    `📏 计算出的边界: left=${result.left}, top=${result.top}, width=${result.width}, height=${result.height}`
  );
  return result;
}

// 2. 修改 getCanvasContentBounds 函数，改进边界选择逻辑
function getCanvasContentBounds(canvas) {
  console.log("🔍 开始计算画布内容边界...");

  // 🔧 优先使用边界对象，确保导出区域完整
  const boundaryObjects = canvas.getObjects().filter((obj) => {
    return obj.customType === "uv_boundary" && obj.excludeFromExport !== true;
  });

  console.log(`🔍 找到 ${boundaryObjects.length} 个边界对象`);

  // 获取所有可导出对象（排除辅助元素）
  const contentObjects = canvas.getObjects().filter((obj) => {
    return (
      obj.visible !== false &&
      obj.excludeFromExport !== true &&
      obj.customType !== "guides" &&
      obj.customType !== "uv_clipPath" &&
      obj.customType !== "uv_raw" &&
      obj.type !== "clipPath"
    );
  });

  console.log(`🔍 找到 ${contentObjects.length} 个内容对象`);

  // UV原始区域对象
  const uvObjects = canvas
    .getObjects()
    .filter((obj) => obj.customType === "uv_raw");
  console.log(`🔍 找到 ${uvObjects.length} 个UV原始对象`);

  // 🔧 新增：辅助线对象（bleed, trim, safe）
  const guideObjects = canvas.getObjects().filter((obj) => {
    return (
      obj.customType &&
      (obj.customType.includes("bleed") ||
        obj.customType.includes("trim") ||
        obj.customType.includes("safe")) &&
      obj.excludeFromExport !== true
    );
  });
  console.log(`🔍 找到 ${guideObjects.length} 个辅助线对象`);

  let finalBounds;

  // 🔧 改进边界选择逻辑
  if (boundaryObjects.length > 0) {
    console.log("📐 使用隐形边界对象计算导出边界");
    finalBounds = calculateBoundsFromObjects(boundaryObjects);
    console.log("📐 边界对象计算结果:", finalBounds);
  }
  // 🔧 新增：如果有辅助线对象，可以考虑使用它们作为边界参考
  else if (guideObjects.length > 0) {
    console.log("📐 使用辅助线对象计算导出边界");
    const guideBounds = calculateBoundsFromObjects(guideObjects);
    console.log("📐 辅助线对象计算结果:", guideBounds);

    // 如果同时有内容对象，取两者的并集
    if (contentObjects.length > 0) {
      const contentBounds = calculateBoundsFromObjects(contentObjects);
      console.log("📐 内容对象计算结果:", contentBounds);

      // 取并集
      finalBounds = {
        left: Math.min(guideBounds.left, contentBounds.left),
        top: Math.min(guideBounds.top, contentBounds.top),
        width:
          Math.max(
            guideBounds.left + guideBounds.width,
            contentBounds.left + contentBounds.width
          ) - Math.min(guideBounds.left, contentBounds.left),
        height:
          Math.max(
            guideBounds.top + guideBounds.height,
            contentBounds.top + contentBounds.height
          ) - Math.min(guideBounds.top, contentBounds.top),
      };
      console.log("📐 辅助线+内容并集结果:", finalBounds);
    } else {
      finalBounds = guideBounds;
    }
  }
  // 如果没有边界对象但有实际内容，使用内容边界
  else if (contentObjects.length > 0) {
    console.log("📐 使用内容对象计算导出边界");
    finalBounds = calculateBoundsFromObjects(contentObjects);
    console.log("📐 内容对象计算结果:", finalBounds);
  }
  // 最后的兜底：使用UV原始区域
  else if (uvObjects.length > 0) {
    console.log("📐 使用UV原始区域计算导出边界");
    finalBounds = calculateBoundsFromObjects(uvObjects);
    console.log("📐 UV原始区域计算结果:", finalBounds);
  }
  // 完全兜底
  else {
    console.log("📐 使用兜底边界");
    finalBounds = { left: 0, top: 0, width: 100, height: 100 };
  }

  // 🔧 检查边界合理性
  if (finalBounds.width < 50 || finalBounds.height < 50) {
    console.warn("⚠️ 检测到边界可能被过度裁剪:", finalBounds);

    if (uvObjects.length > 0) {
      const uvBounds = calculateBoundsFromObjects(uvObjects);
      console.log("🔧 尝试使用UV原始区域边界:", uvBounds);

      if (
        uvBounds.width > finalBounds.width * 1.5 ||
        uvBounds.height > finalBounds.height * 1.5
      ) {
        console.log("✅ 使用UV原始区域边界替代过小的边界");
        finalBounds = uvBounds;
      }
    }
  }

  // 🔧 减少边距，避免过度扩展
  const padding = 5; // 从10减少到5像素
  finalBounds = {
    left: finalBounds.left - padding,
    top: finalBounds.top - padding,
    width: finalBounds.width + padding * 2,
    height: finalBounds.height + padding * 2,
  };

  console.log("✅ 最终导出边界（含边距）:", finalBounds);
  return finalBounds;
}

// 3. 新增：专门处理图片居中的函数
function centerImageInRegion(imageObj, regionBounds) {
  if (!imageObj || !regionBounds) return;

  console.log("🔧 居中图片到区域:", regionBounds);

  // 获取图片的当前尺寸
  const imgWidth = imageObj.getScaledWidth();
  const imgHeight = imageObj.getScaledHeight();

  // 计算居中位置
  const centerX = regionBounds.left + regionBounds.width / 2;
  const centerY = regionBounds.top + regionBounds.height / 2;

  // 设置图片位置（以中心点定位）
  imageObj.set({
    left: centerX - imgWidth / 2,
    top: centerY - imgHeight / 2,
  });

  console.log(
    `✅ 图片已居中到 (${centerX - imgWidth / 2}, ${centerY - imgHeight / 2})`
  );
}

// 4. 新增：SVG viewBox居中修复函数
function fixSVGViewBoxCentering(svgString, actualBounds, targetSize) {
  console.log("🔧 修复SVG viewBox居中问题");
  console.log("  实际边界:", actualBounds);
  console.log("  目标尺寸:", targetSize);

  // 如果边界不是从(0,0)开始，调整viewBox
  if (actualBounds.left !== 0 || actualBounds.top !== 0) {
    const viewBoxRegex = /viewBox="([^"]+)"/;
    const match = svgString.match(viewBoxRegex);

    if (match) {
      // 创建居中的viewBox
      const newViewBox = `viewBox="0 0 ${actualBounds.width} ${actualBounds.height}"`;
      svgString = svgString.replace(viewBoxRegex, newViewBox);
      console.log(`✅ SVG viewBox 已调整为居中: ${newViewBox}`);

      // 同时调整所有transform，将内容移动到以(0,0)为起点
      const offsetX = -actualBounds.left;
      const offsetY = -actualBounds.top;

      if (Math.abs(offsetX) > 0.1 || Math.abs(offsetY) > 0.1) {
        // 在svg根元素内添加一个group来应用偏移
        svgString = svgString.replace(
          /(<svg[^>]*>)/,
          `$1<g transform="translate(${offsetX}, ${offsetY})">`
        );
        svgString = svgString.replace(/<\/svg>/, "</g></svg>");
        console.log(`✅ SVG 内容已偏移 (${offsetX}, ${offsetY}) 以居中`);
      }
    }
  }

  return svgString;
}

// 3. 新增：专门调试画布裁剪问题的函数
function debugCanvasClipping(canvas, regionId) {
  console.log(`🔍 调试画布裁剪问题 - 区域: ${regionId}`);

  // 获取画布尺寸
  console.log(`📐 画布尺寸: ${canvas.getWidth()} x ${canvas.getHeight()}`);

  // 获取所有对象的详细信息
  const allObjects = canvas.getObjects();
  console.log(`📝 画布上共有 ${allObjects.length} 个对象:`);

  allObjects.forEach((obj, index) => {
    const bounds = obj.getBoundingRect(false, false);
    console.log(
      `  ${index}: ${obj.type || obj.customType} - ${
        obj.uvRegionId || "no region"
      } - visible:${obj.visible} - exclude:${obj.excludeFromExport}`,
      bounds
    );
  });

  // 检查边界对象
  const boundaryObjects = allObjects.filter(
    (obj) => obj.customType === "uv_boundary"
  );
  if (boundaryObjects.length > 0) {
    console.log("🔍 边界对象详情:");
    boundaryObjects.forEach((obj, index) => {
      const bounds = obj.getBoundingRect(false, false);
      console.log(`  边界 ${index}: 区域${obj.uvRegionId}`, bounds);
    });
  }

  // 检查UV原始对象
  const uvObjects = allObjects.filter((obj) => obj.customType === "uv_raw");
  if (uvObjects.length > 0) {
    console.log("🔍 UV原始对象详情:");
    uvObjects.forEach((obj, index) => {
      const bounds = obj.getBoundingRect(false, false);
      console.log(`  UV ${index}: 区域${obj.uvRegionId}`, bounds);
    });
  }
}

function prepareExportObjects(canvas) {
  const processedObjects = [];
  const hiddenObjects = []; // 存储需要临时修改的对象

  canvas.getObjects().forEach((obj) => {
    // 处理图片的clipPath（原有逻辑保持不变）
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
      obj.setCoords();
    }

    // 🔧 处理UV区域 - 隐藏填充色但保留轮廓
    if (obj.isUvRegion) {
      hiddenObjects.push({
        obj: obj,
        originalSettings: {
          fill: obj.fill,
          opacity: obj.opacity,
        },
      });
      obj.set({
        fill: "transparent", // 🔧 导出时移除填充色
        opacity: 1, // 🔧 确保轮廓可见
      });
    }

    // 🔧 处理UV剪切路径 - 编辑时可见，导出时隐藏
    if (obj.customType === "uv_clipPath") {
      hiddenObjects.push({
        obj: obj,
        originalSettings: {
          excludeFromExport: obj.excludeFromExport,
        },
      });
      obj.set({
        excludeFromExport: true,
      });
    }

    // 🔧 处理可视化边界 - 导出时隐藏
    if (obj.customType === "uv_visualBorder") {
      hiddenObjects.push({
        obj: obj,
        originalSettings: {
          excludeFromExport: obj.excludeFromExport,
        },
      });
      obj.set({
        excludeFromExport: true,
      });
    }

    // 🔧 处理所有辅助线 - 始终不导出
    if (
      obj.customType &&
      (obj.customType.includes("bleed") ||
        obj.customType.includes("trim") ||
        obj.customType.includes("safe") ||
        obj.customType.includes("fold"))
    ) {
      // 🔧 无需存储原始状态，直接设为不导出
      obj.set({ excludeFromExport: true });
    }
  });

  return {
    processedObjects,
    hiddenObjects,
    restore() {
      // 恢复图片clipPath设置
      processedObjects.forEach(({ originalClipPath, originalClipSettings }) => {
        originalClipPath.set(originalClipSettings);
      });

      // 恢复UV区域和辅助线设置
      hiddenObjects.forEach(({ obj, originalSettings }) => {
        obj.set(originalSettings);
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

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
}
.zoom-controls input[type="range"] {
  width: 150px;
}
.zoom-controls span {
  min-width: 40px;
  text-align: center;
}

/* 添加样式 */
.region-selector {
  margin: 10px 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.region-selector label {
  font-weight: bold;
}

.region-selector select {
  padding: 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.border-toggle {
  display: flex;
  gap: 12px;
  margin: 10px 0;
}
</style>
