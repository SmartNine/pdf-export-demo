import { fabric } from "fabric";

export async function loadSvgToCanvas(canvas, url, tag) {
  console.log(`📥 开始加载 SVG: ${url} (tag: ${tag})`);

  return new Promise((resolve, reject) => {
    // 🔧 添加超时处理
    const timeout = setTimeout(() => {
      console.error(`❌ SVG加载超时: ${url}`);
      reject(new Error(`SVG加载超时: ${url}`));
    }, 10000); // 10秒超时

    fabric.loadSVGFromURL(
      url,
      (objects, options) => {
        clearTimeout(timeout);

        if (!objects || objects.length === 0) {
          console.warn(`⚠️ SVG文件为空或无效: ${url}`);
          resolve();
          return;
        }

        console.log(`✅ SVG加载成功, 对象数量: ${objects.length}`);

        // 🔧 处理每个对象
        const processedObjects = [];

        objects.forEach((obj, index) => {
          try {
            const rawId = obj.id;
            const id = typeof rawId === "string" ? rawId : "" + rawId;

            // 🔧 基础属性设置
            obj.set({
              selectable: false,
              evented: false,
              exportable: false,
              tag,
              id: id,
              // 🔧 确保对象可见
              visible: true,
              opacity: obj.opacity || 1,
            });

            // 🔧 设置线条样式
            if (id.includes("bleed")) {
              obj.set({
                stroke: "red",
                strokeDashArray: [8, 4],
                customType: "bleed",
                fill: "transparent",
              });
            } else if (id.includes("safe")) {
              obj.set({
                stroke: "green",
                strokeDashArray: [5, 5],
                customType: "safe",
                fill: "transparent",
              });
            } else if (id.includes("trim")) {
              obj.set({
                stroke: "gray",
                customType: "trim",
                fill: "transparent",
              });
            } else if (id.includes("fold")) {
              obj.set({
                stroke: "blue",
                strokeDashArray: [4, 4],
                customType: "fold",
                fill: "transparent",
              });
            }

            // 🔧 UV区域特殊处理
            if (tag === "uv") {
              if (id && id.startsWith("uv_region")) {
                obj.set({
                  fill: "#f8f8f8",
                  stroke: "#888",
                  strokeWidth: 1,
                  opacity: 1,
                  preserveOriginalPath: true,
                });
                console.log(`🎯 找到UV区域: ${id}`);
              } else {
                obj.set({
                  stroke: "#888",
                  strokeWidth: 0.5,
                  opacity: 0.2,
                });
              }
            }

            // 🔧 确保路径对象的完整性
            if (obj.type === "path" && obj.path) {
              obj._setPath(obj.path);
            }

            processedObjects.push(obj);
            console.log(`📝 处理对象 ${index}: ${obj.type} (id: ${id})`);
          } catch (error) {
            console.error(`❌ 处理对象 ${index} 时出错:`, error);
          }
        });

        // 🔧 批量添加对象到画布
        try {
          processedObjects.forEach((obj) => {
            canvas.add(obj);
          });

          // 🔧 强制渲染一次
          canvas.requestRenderAll();

          console.log(`✅ 已添加 ${processedObjects.length} 个对象到画布`);

          // 🔧 计算和应用视图变换
          if (processedObjects.length > 0) {
            setTimeout(() => {
              try {
                applyCanvasViewTransform(canvas, processedObjects, tag);
                resolve();
              } catch (error) {
                console.error("❌ 应用视图变换失败:", error);
                resolve(); // 即使失败也要resolve，避免阻塞
              }
            }, 100); // 给渲染一些时间
          } else {
            resolve();
          }
        } catch (error) {
          console.error("❌ 添加对象到画布失败:", error);
          reject(error);
        }
      },
      (item, object) => {
        // 🔧 SVG解析回调 - 确保每个对象都被正确处理
        if (object && object.type === "path") {
          // 确保路径数据完整
          object._setPath && object._setPath(object.path);
        }
        return object;
      }
    );
  });
}

// 🔧 单独的视图变换函数
function applyCanvasViewTransform(canvas, objects, tag) {
  console.log(`🔍 计算视图变换 (tag: ${tag})`);

  // 🔧 确保从干净的变换状态开始
  canvas.setZoom(1);
  canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  // 计算所有对象的边界
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  objects.forEach((obj) => {
    try {
      const bounds = obj.getBoundingRect();
      if (bounds && typeof bounds.left === "number") {
        minX = Math.min(minX, bounds.left);
        minY = Math.min(minY, bounds.top);
        maxX = Math.max(maxX, bounds.left + bounds.width);
        maxY = Math.max(maxY, bounds.top + bounds.height);
      }
    } catch (error) {
      console.warn("⚠️ 获取对象边界失败:", error);
    }
  });

  // 🔧 检查边界是否有效
  if (
    !isFinite(minX) ||
    !isFinite(minY) ||
    !isFinite(maxX) ||
    !isFinite(maxY)
  ) {
    console.warn("⚠️ 无效的边界，跳过视图变换");
    return;
  }

  const bounds = {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  console.log("📐 计算出的边界:", bounds);

  if (bounds.width <= 0 || bounds.height <= 0) {
    console.warn("⚠️ 边界尺寸无效，跳过视图变换");
    return;
  }

  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  // 🔧 计算合适的缩放比例
  const padding = 0.1; // 10% 的边距
  const scaleX = (canvasWidth * (1 - padding)) / bounds.width;
  const scaleY = (canvasHeight * (1 - padding)) / bounds.height;
  const zoom = Math.min(scaleX, scaleY, 2); // 限制最大缩放为2倍

  console.log(
    `🔍 计算缩放: scaleX=${scaleX.toFixed(2)}, scaleY=${scaleY.toFixed(
      2
    )}, 最终zoom=${zoom.toFixed(2)}`
  );

  // 🔧 应用缩放
  canvas.setZoom(zoom);

  // 🔧 计算居中偏移 - 基于原始坐标系
  const offsetX = (canvasWidth - bounds.width * zoom) / 2 - bounds.left * zoom;
  const offsetY = (canvasHeight - bounds.height * zoom) / 2 - bounds.top * zoom;

  console.log(
    `📍 计算偏移: offsetX=${offsetX.toFixed(2)}, offsetY=${offsetY.toFixed(2)}`
  );

  // 🔧 使用 setViewportTransform 而不是 absolutePan 来避免累积偏移
  const vpt = [zoom, 0, 0, zoom, offsetX, offsetY];
  canvas.setViewportTransform(vpt);

  // 🔧 保存视图变换信息
  canvas._originalViewTransform = {
    zoom: zoom,
    offsetX: offsetX,
    offsetY: offsetY,
    bounds: bounds,
    tag: tag,
    viewportTransform: [...vpt],
  };

  // 🔧 强制重新渲染
  canvas.requestRenderAll();

  console.log("✅ 视图变换应用完成", vpt);
}

// 🔧 导出辅助函数：重置视图变换
export function resetCanvasViewTransform(canvas) {
  if (!canvas) return;

  console.log("🔄 重置画布视图变换");
  canvas.setZoom(1);
  canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.requestRenderAll();
}

// 🔧 导出辅助函数：获取原始视图信息
export function getOriginalViewTransform(canvas) {
  return canvas._originalViewTransform || null;
}
