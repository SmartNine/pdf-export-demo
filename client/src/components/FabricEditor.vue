<template>
  <div>
    <select v-model="selectedRegion" @change="switchRegion">
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
        />
        {{ type }}
      </label>
    </div>
    <input type="file" accept="image/*" @change="onImageUpload" />
    <button @click="exportDesign">导出 PDF</button>
    <button @click="saveLocally">保存本地</button>
    <canvas ref="canvasEl" width="800" height="800"></canvas>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from "vue";
import { fabric } from "fabric";
import { loadSvgToCanvas } from "../utils/svgLoader";

const canvas = ref(null);
const canvasEl = ref(null);
const selectedRegion = ref("uv_01");
const regions = ["uv_01", "uv_02"];

const lineVisibility = reactive({
  bleed: true,
  trim: true,
  safe: true,
  fold: true,
});

async function loadDesign(region) {
  const res = await fetch(`/template/${region}/design.json`);
  const json = await res.json();

  if (json.objects && json.objects.length > 0) {
    canvas.value.loadFromJSON(json, canvas.value.renderAll.bind(canvas.value));
  } else {
    canvas.value.renderAll();
  }
}

async function switchRegion() {
  canvas.value.clear();

  await loadSvgToCanvas(
    canvas.value,
    `/template/${selectedRegion.value}/uv_outline.svg`,
    "uv"
  );

  await loadSvgToCanvas(
    canvas.value,
    `/template/${selectedRegion.value}/outlines.svg`,
    "guides"
  );

  Object.keys(lineVisibility).forEach((type) => {
    toggleLine(type);
  });

  await loadDesign(selectedRegion.value);
}

function toggleLine(type) {
  canvas.value.getObjects().forEach((obj) => {
    if (obj.customType === type) {
      obj.visible = lineVisibility[type];
    }
  });
  canvas.value.requestRenderAll();
}

async function importImageToCanvas(file) {
  const region = canvas.value
    .getObjects()
    .find((obj) => obj.id?.startsWith("uv_region"));
  if (!region) return;

  const clip = fabric.util.object.clone(region);
  clip.absolutePositioned = true;
  clip.inverted = false;

  const dataUrl = await resizeImage(file, 2048);
  fabric.Image.fromURL(dataUrl, (img) => {
    img.set({
      left: 100,
      top: 100,
      scaleX: 1,
      scaleY: 1,
      selectable: true,
      hasControls: true,
      hasBorders: true,
      clipPath: clip,
    });
    canvas.value.add(img);
    canvas.value.setActiveObject(img);
    canvas.value.requestRenderAll();
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

async function exportDesign() {
  const zoomBackup = canvas.value.getZoom();
  const viewportBackup = canvas.value.viewportTransform;
  canvas.value.setZoom(1);
  canvas.value.viewportTransform = [1, 0, 0, 1, 0, 0];
  canvas.value.requestRenderAll();

  canvas.value.getObjects().forEach((obj) => {
    if (obj.type === "image" && obj.clipPath) {
      obj.clipPath.absolutePositioned = true;
    }
  });

  const json = canvas.value.toDatalessJSON();

  canvas.value.setZoom(zoomBackup);
  canvas.value.viewportTransform = viewportBackup;
  canvas.value.requestRenderAll();

  const clonedCanvas = new fabric.Canvas(null, {
    width: canvas.value.getWidth(),
    height: canvas.value.getHeight(),
  });

  await new Promise((resolve) => {
    clonedCanvas.loadFromJSON(json, () => {
      clonedCanvas.getObjects().forEach((obj) => {
        if (obj.type === "image" && obj.clipPath) {
          obj.clipPath.absolutePositioned = true;
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
  });

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

  try {
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
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function saveLocally() {
  // 生成 SVG 和 JSON（与导出逻辑一致）
  const json = canvas.value.toDatalessJSON();
  const svg = canvas.value.toSVG({
    suppressPreamble: false,
    viewBox: {
      x: 0,
      y: 0,
      width: canvas.value.getWidth(),
      height: canvas.value.getHeight(),
    },
  });

  // 下载两个文件
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "design.svg");
  downloadBlob(
    new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }),
    "data.json"
  );
}

onMounted(async () => {
  canvas.value = new fabric.Canvas(canvasEl.value);

  canvas.value.on("object:moving", (e) => {
    const obj = e.target;
    if (obj) {
      console.log("对象正在拖动:", obj.left, obj.top);
    }
  });

  await switchRegion();
});
</script>

<style scoped>
.line-toggle {
  display: flex;
  gap: 12px;
  margin: 10px 0;
}
</style>
