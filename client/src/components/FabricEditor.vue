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

    await new Promise((resolve) => {
      clonedCanvas.loadFromJSON(json, () => {
        clonedCanvas.getObjects().forEach((obj) => obj.setCoords());
        clonedCanvas.renderAll();
        resolve();
      });
    });

    // 🔧 关键修复：计算实际内容边界
    const contentBounds = getCanvasContentBounds(clonedCanvas);

    // 🔧 使用内容边界而不是画布尺寸
    const finalSVG = clonedCanvas.toSVG({
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

    // ✅ 加入 mm 单位 - 使用内容尺寸
    const finalSVGWithSize = addSizedSVGAttributes(
      finalSVG,
      contentBounds.width,
      contentBounds.height
    );

    clonedCanvas.dispose();

    // 其余代码保持不变...
    const formData = new FormData();
    formData.append(
      "design",
      new Blob([finalSVGWithSize], { type: "image/svg+xml" }),
      "design.svg"
    );
    formData.append(
      "json",
      new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }),
      "data.json"
    );
    const previewBlob = await getPreviewBlob(canvas.value);
    formData.append("preview", previewBlob, "preview.png");

    const images = canvas.value
      .getObjects()
      .filter((obj) => obj.type === "image" && obj._element?.src);

    for (let i = 0; i < images.length; i++) {
      const imgObj = images[i];
      const file = await fetch(imgObj._element.src)
        .then((res) => res.blob())
        .then(
          (blob) => new File([blob], `image${i + 1}.jpg`, { type: blob.type })
        );
      formData.append("images", file);
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

function fixClipPathInSVGMarkup(markup, object) {
  if (!object.clipPath) return markup;

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

// 5. 添加调试函数（可选）
function debugContentBounds() {
  if (!canvas.value) return;

  const bounds = getCanvasContentBounds(canvas.value);
  console.log("🔍 当前内容边界:", bounds);

  const canvasSize = {
    width: canvas.value.getWidth(),
    height: canvas.value.getHeight(),
  };
  console.log("🔍 画布尺寸:", canvasSize);

  // 在画布上可视化边界框（调试用）
  const rect = new fabric.Rect({
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    fill: "transparent",
    stroke: "red",
    strokeWidth: 2,
    strokeDashArray: [10, 5],
    selectable: false,
    evented: false,
  });

  canvas.value.add(rect);
  canvas.value.renderAll();

  // 3秒后移除边界框
  setTimeout(() => {
    canvas.value.remove(rect);
    canvas.value.renderAll();
  }, 3000);
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
    });

    canvas.value.on("object:moving", (e) => {
      const obj = e.target;
      if (obj) {
        console.log("对象正在拖动:", obj.left, obj.top);
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
