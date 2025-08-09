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

    <button @click="addText" :disabled="isLoading">添加文字</button>
    <!-- <button @click="exportDesign" :disabled="isLoading">导出 PDF</button> -->
    <button @click="exportMultipleRegions" :disabled="isLoading">
      分区域导出 PDF
    </button>
    <button @click="downloadZip" :disabled="!zipDownloadUrl">下载 ZIP</button>
    <!-- <button v-if="isDev" @click="saveLocally" :disabled="isLoading">
      保存本地
    </button> -->
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
];

const selectedFont = ref("Roboto Condensed"); // 默认字体

// 🔧 添加一个变量来存储开发模式状态
const isDev = import.meta.env.DEV;

const canvas = ref(null);
const canvasEl = ref(null);
const fileInputRef = ref(null); // 🔧 新增：文件输入框的引用
const selectedRegion = ref("uv_01");
const regions = [
  "uv_01",
  "uv_02",
  "uv_03",
  "uv_04_01",
  "uv_04_02",
  "uv_04_03",
  "uv_05",
];
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
  if (file) {
    // 如果只有一个区域或用户没有选择，使用默认逻辑
    if (availableRegions.value.length <= 1 || !selectedImageRegion.value) {
      importImageToCanvas(file);
    } else {
      // 使用用户选择的区域
      importImageToSpecificRegion(file, selectedImageRegion.value);
    }
  }
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
        const relativePath = `../images/${fileName}`; // 🔧 添加 ../
        const base64Pattern = /href="data:image\/[^;]+;base64,[^"]*"/;
        const xlinkBase64Pattern =
          /xlink:href="data:image\/[^;]+;base64,[^"]*"/;

        if (base64Pattern.test(finalSVG)) {
          finalSVG = finalSVG.replace(base64Pattern, `href="${relativePath}"`);
        } else if (xlinkBase64Pattern.test(finalSVG)) {
          finalSVG = finalSVG.replace(
            xlinkBase64Pattern,
            `xlink:href="${relativePath}"`
          );
        }
      });

      const finalSVGWithSize = addSizedSVGAttributes(
        finalSVG,
        contentBounds.width,
        contentBounds.height
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
        const relativePath = `../images/${fileName}`; // 🔧 添加 ../
        const jsonBase64Pattern =
          /"src"\s*:\s*"data:image\/[^;]+;base64,[^"]*"/g;
        processedJSON = processedJSON.replace(
          jsonBase64Pattern,
          `"src":"${relativePath}"`
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

  console.log(`📍 导入图片到指定区域: ${regionId}`);

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
        originalFile: file,
        // 🆕 明确标记所属的UV区域ID
        uvRegionId: regionId,
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

      console.log(`✅ 图片成功导入到区域 ${regionId}`);
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
    alert(`✅ 成功生成 ${regionExports.length} 个区域的PDF文件！`);
  } else {
    alert("分区域导出失败，请检查服务器日志");
  }
}
// 分页导出

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

    imageFileNames.forEach((fileName) => {
      const relativePath = `../images/${fileName}`; // 🔧 添加 ../ 回到上级目录

      const base64Pattern = /href="data:image\/[^;]+;base64,[^"]*"/;
      const xlinkBase64Pattern = /xlink:href="data:image\/[^;]+;base64,[^"]*"/;

      if (base64Pattern.test(finalSVG)) {
        finalSVG = finalSVG.replace(base64Pattern, `href="${relativePath}"`);
      } else if (xlinkBase64Pattern.test(finalSVG)) {
        finalSVG = finalSVG.replace(
          xlinkBase64Pattern,
          `xlink:href="${relativePath}"`
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
      const relativePath = `../images/${fileName}`; // 🔧 修改：添加 ../ 回到上级目录

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
    const jsonHasImages = processedJSON.includes("../images/"); // 🔧 修改验证路径
    console.log(
      `🔍 JSON处理结果: 包含base64=${jsonHasBase64}, 包含../images/=${jsonHasImages}`
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

// 修改 generateFontStylesForSVG 函数中的字体路径
function generateFontStylesForSVG(fontNames, fontUrlMap) {
  let fontStyles = "";
  for (const fontName of fontNames) {
    const fontUrl = fontUrlMap.get(fontName);
    if (fontUrl) {
      const fontFileName = fontUrl.split("/").pop();
      fontStyles += `
        @font-face {
          font-family: '${fontName}';
          src: url('../fonts/${fontFileName}'); // 🔧 添加 ../ 回到上级目录
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

    restore();

    canvas.value.setZoom(backupState.zoom);
    canvas.value.setViewportTransform(backupState.viewportTransform);
    canvas.value._originalViewTransform = backupState.originalViewTransform;
    canvas.value.requestRenderAll();

    // 🔧 创建临时克隆 canvas，与 exportDesign 保持一致
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

    // 💡 本地保存：保持 base64 内嵌格式，确保文件自包含
    console.log("💾 本地保存模式：保持图片 base64 内嵌格式");

    // ✅ 加入 mm 单位 - 使用内容尺寸
    const finalSVGWithSize = addSizedSVGAttributes(
      finalSVG,
      contentBounds.width,
      contentBounds.height
    );

    // 💾 本地保存：保持原始JSON格式（包含base64）
    console.log("💾 保持JSON原始格式（包含base64图片数据）");
    let processedJSON = JSON.stringify(json, null, 2);

    // 🔧 验证本地保存格式
    const jsonHasBase64 = processedJSON.includes("base64");
    const svgHasBase64 = finalSVGWithSize.includes("base64");
    console.log(
      `🔍 本地保存验证: JSON包含base64=${jsonHasBase64}, SVG包含base64=${svgHasBase64}`
    );

    // 🔧 清理临时 canvas
    clonedCanvas.dispose();

    // 💡 下载文件
    downloadBlob(
      new Blob([finalSVGWithSize], { type: "image/svg+xml" }),
      "design.svg"
    );
    downloadBlob(
      new Blob([processedJSON], { type: "application/json" }),
      "data.json"
    );
  } catch (error) {
    console.error("保存失败:", error);
    alert("保存失败！");
  } finally {
    isLoading.value = false;
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

    // 🔧 处理UV区域 - 标记为不导出而不是修改样式
    if (obj.isUvRegion) {
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

    // 🔧 重要：隐形边界对象始终参与导出，不做任何修改
    // if (obj.customType === "uv_boundary") {
    //   // 不做任何处理，让它正常参与导出
    // }

    // 处理辅助线 - 根据复选框状态决定是否导出
    if (obj.customType && lineVisibility[obj.customType] !== undefined) {
      hiddenObjects.push({
        obj: obj,
        originalSettings: {
          excludeFromExport: obj.excludeFromExport,
        },
      });

      if (!lineVisibility[obj.customType]) {
        obj.set({ excludeFromExport: true });
      } else {
        obj.set({ excludeFromExport: false });
      }
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
</style>
