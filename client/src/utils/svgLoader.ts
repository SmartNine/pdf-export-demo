import { fabric } from "fabric";

export async function loadSvgToCanvas(canvas, url, tag) {
  return new Promise((resolve) => {
    fabric.loadSVGFromURL(url, (objects) => {
      objects.forEach((obj) => {
        const rawId = obj.id;
        const id = typeof rawId === "string" ? rawId : "" + rawId; // 保证是字符串

        obj.set({
          selectable: false,
          evented: false,
          exportable: false,
          tag,
        });

        if (id.includes("bleed")) {
          obj.set({ stroke: "red", strokeDashArray: [8, 4] });
          obj.set({ customType: "bleed" });
        } else if (id.includes("safe")) {
          obj.set({ stroke: "green", strokeDashArray: [5, 5] });
          obj.set({ customType: "safe" });
        } else if (id.includes("trim")) {
          obj.set({ stroke: "gray" });
          obj.set({ customType: "trim" });
        } else if (id.includes("fold")) {
          obj.set({ stroke: "blue", strokeDashArray: [4, 4] });
          obj.set({ customType: "fold" });
        }

        if (tag === "uv") {
          if (id && id.startsWith("uv_region")) {
            obj.set({
              fill: "#f8f8f8", // 你可以改成任何浅色背景
              stroke: "#888",
              opacity: 1,
            });
          } else {
            obj.set({
              stroke: "#888",
              opacity: 0.2,
            });
          }
        }

        canvas.add(obj);
      });

      canvas.requestRenderAll();

      if (objects.length > 0) {
        const group = new fabric.Group(objects);
        const bounds = group.getBoundingRect();

        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();

        const scaleX = (canvasWidth * 0.8) / bounds.width;
        const scaleY = (canvasHeight * 0.8) / bounds.height;
        const zoom = Math.min(scaleX, scaleY);

        // 设置缩放并居中视图
        canvas.setZoom(zoom);
        // ✅ 计算偏移，使内容居中
        const offsetX =
          (canvasWidth - bounds.width * zoom) / 2 - bounds.left * zoom;
        const offsetY =
          (canvasHeight - bounds.height * zoom) / 2 - bounds.top * zoom;

        canvas.absolutePan(new fabric.Point(offsetX, offsetY));
      }
      resolve();
    });
  });
}
