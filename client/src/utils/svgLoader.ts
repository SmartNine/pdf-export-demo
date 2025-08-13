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
        const uvPathData = {}; // 🆕 改为对象，按区域ID分组存储
        const uvObjects = []; // 用于存储原始 UV 区域对象

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
                excludeFromExport: true,
              });
            } else if (id.includes("safe")) {
              obj.set({
                stroke: "green",
                strokeDashArray: [5, 5],
                customType: "safe",
                fill: "transparent",
                excludeFromExport: true,
              });
            } else if (id.includes("trim")) {
              obj.set({
                stroke: "gray",
                customType: "trim",
                fill: "transparent",
                excludeFromExport: true,
              });
            } else if (id.includes("fold")) {
              obj.set({
                stroke: "blue",
                strokeDashArray: [4, 4],
                customType: "fold",
                fill: "transparent",
                excludeFromExport: true,
              });
            }

            // 🔧 UV区域特殊处理 - 核心修改部分
            if (tag === "uv" && id && id.startsWith("uv_region")) {
              let pathData = null;

              switch (obj.type) {
                case "path":
                  if (obj.path) {
                    pathData = obj.path
                      .map((segment) => segment.join(" "))
                      .join(" ");
                  }
                  break;
                case "polygon":
                  if (obj.points) {
                    pathData = `M ${obj.points
                      .map((p) => `${p.x} ${p.y}`)
                      .join(" L ")} Z`;
                  }
                  break;
                case "rect":
                  const { left, top, width, height } = obj;
                  console.log(
                    `✅ rect属性: left=${left}, top=${top}, width=${width}, height=${height}`
                  );
                  pathData = `M ${left} ${top} L ${left + width} ${top} L ${
                    left + width
                  } ${top + height} L ${left} ${top + height} Z`;
                  console.log(
                    `✅ 从rect提取路径数据: ${pathData.substring(0, 50)}...`
                  );
                  break;
                case "circle":
                  // 新增：处理 circle 对象
                  const { left: circleLeft, top: circleTop, radius } = obj;
                  const cx = circleLeft + radius;
                  const cy = circleTop + radius;
                  pathData = `M ${cx},${cy} m ${-radius}, 0 a ${radius},${radius} 0 1,0 ${
                    radius * 2
                  },0 a ${radius},${radius} 0 1,0 ${-radius * 2},0`;
                  break;
                default:
                  console.warn(
                    `⚠️ 发现未处理的UV区域对象类型: ${obj.type} (id: ${id})`
                  );
                  break;
              }

              if (pathData) {
                // 🆕 新增：按区域分组存储路径数据
                if (!uvPathData[id]) {
                  uvPathData[id] = [];
                }
                uvPathData[id].push(pathData);
              }

              // 将原始 UV 区域对象设置为编辑时可见，导出时隐藏
              obj.set({
                fill: "#f8f8f8",
                stroke: "#888",
                strokeWidth: 1,
                opacity: 1,
                visible: true,
                selectable: false,
                evented: false,
                customType: "uv_raw", // 标记为原始 UV 对象，用于计算边界
                // 新增标记，用于导出时识别
                isUvRegion: true,
                // 🆕 新增：记录所属UV区域ID
                uvRegionId: id,
              });
              uvObjects.push(obj);
            } else if (tag === "uv") {
              // 其他 uv 文件中的非 uv_region 对象，例如辅助线
              obj.set({
                stroke: "#888",
                strokeWidth: 0.5,
                opacity: 0.2,
                customType: "uv_guide",
                excludeFromExport: true,
              });
            }

            // 确保路径对象的完整性
            if (obj.type === "path" && obj.path) {
              obj._setPath(obj.path);
            }

            processedObjects.push(obj);
            console.log(`📝 处理对象 ${index}: ${obj.type} (id: ${id})`);
          } catch (error) {
            console.error(`❌ 处理对象 ${index} 时出错:`, error);
          }
        });

        // 🔧 在所有对象处理完成后，为每个UV区域创建独立的clipPath
        if (Object.keys(uvPathData).length > 0) {
          // 🆕 为每个UV区域创建独立的clipPath和边界对象
          Object.entries(uvPathData).forEach(([regionId, paths]) => {
            const mergedPathData = paths.join(" ");

            // 🔧 确保路径数据的正确性
            console.log(
              `🔧 创建区域 ${regionId} 的clipPath，路径数据长度: ${mergedPathData.length}`
            );

            // 🔧 修改：创建纯粹的剪切路径（不可见）
            const uvClipPath = new fabric.Path(mergedPathData, {
              absolutePositioned: true,
              visible: true,
              selectable: false,
              evented: false,
              fill: "rgba(248,248,248,1)",
              stroke: "#888",
              strokeWidth: 1,
              opacity: 1,
              customType: "uv_clipPath",
              id: `${regionId}_clipPath`,
              uvRegionId: regionId,
            });

            // 🆕 新增：创建可选的可视化边界（用户可以控制显示/隐藏）
            const uvVisualBorder = new fabric.Path(mergedPathData, {
              absolutePositioned: true,
              visible: true, // 🔧 默认可见，但用户可以控制
              selectable: false,
              evented: false,
              fill: "transparent", // 🔧 无填充，不影响图片
              stroke: "#888", // 🔧 只有边框线
              strokeWidth: 1,
              strokeDashArray: [5, 5], // 🔧 虚线边框，更好区分
              opacity: 1, // 🔧 完全不透明的边框
              customType: "uv_visualBorder",
              id: `${regionId}_visualBorder`,
              uvRegionId: regionId,
              excludeFromExport: true, // 🔧 导出时排除
            });

            // 创建该区域的隐形边界对象（用于导出）
            const invisibleBoundary = new fabric.Path(mergedPathData, {
              absolutePositioned: true,
              visible: false, // 🔧 设为不可见，避免干扰视觉
              selectable: false,
              evented: false,
              fill: "transparent",
              stroke: "transparent",
              strokeWidth: 0,
              opacity: 0,
              customType: "uv_boundary",
              id: `${regionId}_boundary`,
              uvRegionId: regionId,
              excludeFromExport: false, // 🔧 确保参与导出
            });

            // 🔧 确保所有路径正确设置
            [uvClipPath, uvVisualBorder, invisibleBoundary].forEach(
              (pathObj) => {
                if (pathObj.path) {
                  pathObj._setPath(pathObj.path);
                }
              }
            );

            processedObjects.push(uvClipPath);
            processedObjects.push(uvVisualBorder);
            processedObjects.push(invisibleBoundary);
          });

          console.log(
            `✅ 已创建 ${Object.keys(uvPathData).length} 个UV区域的剪切路径`
          );
        }

        // 🔧 批量添加对象到画布
        try {
          const viewBoxAttr = options && options.viewBox;
          if (viewBoxAttr) {
            const [, , viewBoxWidth, viewBoxHeight] = viewBoxAttr
              .split(/\s+/)
              .map(Number);

            if (viewBoxWidth && viewBoxHeight) {
              canvas.setWidth(viewBoxWidth);
              canvas.setHeight(viewBoxHeight);

              const maxSize = 800;
              const scale = Math.min(
                maxSize / viewBoxWidth,
                maxSize / viewBoxHeight
              );

              const dx = (maxSize - viewBoxWidth * scale) / 2;
              const dy = (maxSize - viewBoxHeight * scale) / 2;
              canvas.setViewportTransform([scale, 0, 0, scale, dx, dy]);

              console.log(
                `🎯 已设置画布大小: ${viewBoxWidth}x${viewBoxHeight}，缩放: ${scale}`
              );
            }
          }

          processedObjects.forEach((obj) => {
            canvas.add(obj);
          });

          canvas.requestRenderAll();

          console.log(`✅ 已添加 ${processedObjects.length} 个对象到画布`);

          if (processedObjects.length > 0) {
            setTimeout(() => {
              try {
                applyCanvasViewTransform(canvas, processedObjects, tag);
                resolve();
              } catch (error) {
                console.error("❌ 应用视图变换失败:", error);
                resolve();
              }
            }, 100);
          } else {
            resolve();
          }
        } catch (error) {
          console.error("❌ 添加对象到画布失败:", error);
          reject(error);
        }
      },
      (item, object) => {
        if (object && object.type === "path") {
          object._setPath && object._setPath(object.path);
        }
        return object;
      }
    );
  });
}

// 🆕 新增：导出函数 - 获取所有UV区域ID
export function getUVRegionIds(canvas) {
  const uvRegionIds = new Set();
  canvas.getObjects().forEach((obj) => {
    if (obj.uvRegionId) {
      uvRegionIds.add(obj.uvRegionId);
    }
  });
  return Array.from(uvRegionIds);
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
