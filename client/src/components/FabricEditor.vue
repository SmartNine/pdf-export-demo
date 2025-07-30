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
    />
    <button @click="exportDesign" :disabled="isLoading">导出 PDF</button>
    <button @click="saveLocally" :disabled="isLoading">保存本地</button>
    <button @click="debugClipPaths" :disabled="isLoading">调试 ClipPath</button>
    <button @click="resetViewTransform" :disabled="isLoading">重置视图</button>

    <canvas ref="canvasEl" width="800" height="800"></canvas>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from "vue";
import { fabric } from "fabric";
import { loadSvgToCanvas } from "../utils/svgLoader";

const canvas = ref(null);
const canvasEl = ref(null);
const selectedRegion = ref("uv_01");
const regions = ["uv_01", "uv_02"];
const isLoading = ref(false);

const lineVisibility = reactive({
  bleed: true,
  trim: true,
  safe: true,
  fold: true,
});

// 🔧 添加初始化状态追踪
const canvasReady = ref(false);
const loadingQueue = ref([]);

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

  const region = canvas.value
    .getObjects()
    .find((obj) => obj.id?.startsWith("uv_region"));
  if (!region) {
    console.error("❌ 未找到 uv_region");
    return;
  }

  console.log("📸 导入图片到画布");

  // 获取 UV 区域对象在画布坐标系中的原始 left/top/width/height
  // Fabric.js 对象的 left/top/width/height 属性是其在“不缩放、不平移”的画布上的逻辑尺寸和位置。
  // 这些是我们在内部操作对象时应该依赖的值。
  const regionOriginalLeft = region.left;
  const regionOriginalTop = region.top;
  const regionOriginalWidth = region.width * region.scaleX; // 考虑到 region 自身的缩放
  const regionOriginalHeight = region.height * region.scaleY;

  // 克隆 region 对象作为 clipPath
  const clip = fabric.util.object.clone(region);

  // 💡 关键修改：clipPath 的设置
  // 当 clipPath 设为 absolutePositioned: true 时，它的 left/top/scaleX/scaleY
  // 应该直接是它在画布坐标系中的“目标”位置和尺寸。
  // 它应该和它所裁剪的图片有相同的 left/top/scaleX/scaleY。
  // 但是，clipPath 的 path 是 uv_region 的 path。
  // 确保 clipPath 的缩放和位置与 region 的原始逻辑位置和缩放一致。
  clip.set({
    absolutePositioned: true, // 保持 absolutePositioned 为 true
    left: regionOriginalLeft, // clipPath 的左上角应该和 region 的原始左上角对齐
    top: regionOriginalTop, // clipPath 的左上角应该和 region 的原始左上角对齐
    scaleX: region.scaleX, // clipPath 的缩放应该和 region 的原始缩放一致
    scaleY: region.scaleY, // clipPath 的缩放应该和 region 的原始缩放一致
    angle: region.angle, // 角度保持一致
    inverted: false,
    path: region.path, // 路径保持不变
    // 确保 clipPath 的 originX/Y 和被裁剪对象一致，通常默认为 'left', 'top'
    originX: "left",
    originY: "top",
  });

  const dataUrl = await resizeImage(file, 2048);

  return new Promise((resolve) => {
    fabric.Image.fromURL(dataUrl, (img) => {
      // 💡 图片的定位和缩放策略
      // 图片的 left/top 应该和 region 的原始 left/top 对齐
      // 图片的 scale 应该根据 region 的原始尺寸和图片的原始尺寸来计算，以填充或适应 region
      img.set({
        left: regionOriginalLeft, // 图片的左上角与 region 的原始左上角对齐
        top: regionOriginalTop, // 图片的左上角与 region 的原始左上角对齐
        selectable: true,
        hasControls: true,
        hasBorders: true,
        clipPath: clip,
        // 确保图片的 originX/Y 和 clipPath 一致
        originX: "left",
        originY: "top",
      });

      // 调整图片的缩放以适应 uv_region 的尺寸
      // 这里的策略是让图片“覆盖”整个 uv_region 区域，可能会超出，然后由 clipPath 裁剪。
      if (img.width && img.height) {
        const scaleX = regionOriginalWidth / img.width;
        const scaleY = regionOriginalHeight / img.height;
        const imgScale = Math.max(scaleX, scaleY); // 选择较大的缩放，确保覆盖

        img.set({
          scaleX: imgScale,
          scaleY: imgScale,
        });

        // 居中图片在裁剪区域内（如果图片比裁剪区域大）
        // 这需要更精确的计算，因为图片可能比裁剪区域大
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

// 🔧 修复导出函数中的视图变换恢复
async function exportDesign() {
  if (!canvas.value || isLoading.value) return;

  isLoading.value = true;

  try {
    // 🔧 备份当前完整的变换状态
    const backupState = {
      zoom: canvas.value.getZoom(),
      viewportTransform: [...canvas.value.viewportTransform],
      originalViewTransform: canvas.value._originalViewTransform,
    };

    console.log("💾 备份视图状态:", backupState);

    // 重置到标准状态进行导出
    canvas.value.setZoom(1);
    canvas.value.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const processedObjects = [];
    canvas.value.getObjects().forEach((obj) => {
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
          },
        });

        const imgBounds = obj.getBoundingRect(true);
        const clipPath = obj.clipPath;

        clipPath.set({
          absolutePositioned: true,
          left: 0,
          top: 0,
          scaleX: 1,
          scaleY: 1,
        });

        obj.set({
          left: imgBounds.left,
          top: imgBounds.top,
        });
      }
    });

    canvas.value.requestRenderAll();
    const json = canvas.value.toDatalessJSON();

    // 恢复 clipPath 设置
    processedObjects.forEach(
      ({ obj, originalClipPath, originalClipSettings }) => {
        originalClipPath.set(originalClipSettings);
      }
    );

    // 🔧 精确恢复视图状态
    canvas.value.setZoom(backupState.zoom);
    canvas.value.setViewportTransform(backupState.viewportTransform);
    canvas.value._originalViewTransform = backupState.originalViewTransform;
    canvas.value.requestRenderAll();

    console.log("🔄 恢复视图状态:", backupState);

    // 创建导出画布
    const tempCanvas = document.createElement("canvas");
    const clonedCanvas = new fabric.Canvas(tempCanvas, {
      width: canvas.value.getWidth(),
      height: canvas.value.getHeight(),
    });

    await new Promise((resolve) => {
      clonedCanvas.loadFromJSON(json, () => {
        clonedCanvas.getObjects().forEach((obj) => {
          if (obj.type === "image" && obj.clipPath) {
            obj.clipPath.set({
              absolutePositioned: true,
              left: 0,
              top: 0,
              scaleX: 1,
              scaleY: 1,
            });
          }
        });
        clonedCanvas.renderAll();
        resolve();
      });
    });

    const finalSVG = clonedCanvas.toSVG({
      suppressPreamble: false,
      viewBox: {
        x: 0,
        y: 0,
        width: clonedCanvas.getWidth(),
        height: clonedCanvas.getHeight(),
      },
      reviver: (markup, object) => {
        if (object.clipPath) {
          return fixClipPathInSVGMarkup(markup, object);
        }
        return markup;
      },
    });

    clonedCanvas.dispose();

    const formData = new FormData();
    formData.append(
      "design",
      new Blob([finalSVG], { type: "image/svg+xml" }),
      "design.svg"
    );
    formData.append(
      "json",
      new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      }),
      "data.json"
    );

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
    const result = JSON.parse(text);

    if (result.success) {
      window.open(result.download.pdf, "_blank");
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

function fixClipPathInSVGMarkup(markup, object) {
  if (!object.clipPath) return markup;

  const clipPathRegex = /<clipPath[^>]*>/;
  const match = markup.match(clipPathRegex);

  if (match) {
    const originalClipPath = match[0];
    const fixedClipPath = originalClipPath.replace(
      /transform="[^"]*"/g,
      'transform="translate(0,0)"'
    );
    return markup.replace(originalClipPath, fixedClipPath);
  }

  return markup;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 🔧 修复后的保存本地函数 - 使用相同的精确备份恢复逻辑
async function saveLocally() {
  if (!canvas.value || isLoading.value) return;

  isLoading.value = true;

  try {
    // 🔧 备份当前完整的变换状态
    const backupState = {
      zoom: canvas.value.getZoom(),
      viewportTransform: [...canvas.value.viewportTransform],
      originalViewTransform: canvas.value._originalViewTransform,
    };

    canvas.value.setZoom(1);
    canvas.value.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const processedObjects = [];
    canvas.value.getObjects().forEach((obj) => {
      if (obj.type === "image" && obj.clipPath) {
        processedObjects.push({
          obj: obj,
          originalClipSettings: {
            absolutePositioned: obj.clipPath.absolutePositioned,
            left: obj.clipPath.left,
            top: obj.clipPath.top,
            scaleX: obj.clipPath.scaleX,
            scaleY: obj.clipPath.scaleY,
          },
        });

        obj.clipPath.set({
          absolutePositioned: true,
          left: 0,
          top: 0,
          scaleX: 1,
          scaleY: 1,
        });
      }
    });

    canvas.value.requestRenderAll();

    const json = canvas.value.toDatalessJSON();
    const svg = canvas.value.toSVG({
      suppressPreamble: false,
      viewBox: {
        x: 0,
        y: 0,
        width: canvas.value.getWidth(),
        height: canvas.value.getHeight(),
      },
      reviver: (markup, object) => {
        if (object.clipPath) {
          return fixClipPathInSVGMarkup(markup, object);
        }
        return markup;
      },
    });

    processedObjects.forEach(({ obj, originalClipSettings }) => {
      obj.clipPath.set(originalClipSettings);
    });

    // 🔧 精确恢复视图状态
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

function debugClipPaths() {
  if (!canvas.value) return;

  console.log("=== ClipPath Debug Info ===");
  canvas.value.getObjects().forEach((obj, index) => {
    if (obj.type === "image" && obj.clipPath) {
      const objBounds = obj.getBoundingRect(true);
      const clipBounds = obj.clipPath.getBoundingRect();

      console.log(`Image ${index}:`, {
        image: {
          left: obj.left,
          top: obj.top,
          width: obj.width,
          height: obj.height,
          scaleX: obj.scaleX,
          scaleY: obj.scaleY,
          bounds: objBounds,
        },
        clipPath: {
          left: obj.clipPath.left,
          top: obj.clipPath.top,
          width: obj.clipPath.width,
          height: obj.clipPath.height,
          scaleX: obj.clipPath.scaleX,
          scaleY: obj.clipPath.scaleY,
          absolutePositioned: obj.clipPath.absolutePositioned,
          bounds: clipBounds,
        },
      });
    }
  });
}

// 🔧 添加手动重置视图的调试功能
function resetViewTransform() {
  if (!canvas.value) return;

  resetCanvasToInitialState();

  // 重新应用最后保存的视图变换
  if (canvas.value._originalViewTransform) {
    const vpt = canvas.value._originalViewTransform.viewportTransform;
    if (vpt) {
      canvas.value.setViewportTransform([...vpt]);
      canvas.value.requestRenderAll();
    }
  }
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
