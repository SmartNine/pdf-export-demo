const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const taskId = req.taskId;
    const isFont = file.fieldname === "fonts";
    const isImage = file.fieldname === "images";
    const dir = path.join(
      __dirname,
      "../exports",
      taskId,
      isFont ? "fonts" : isImage ? "images" : ""
    );
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

router.post(
  "/",
  (req, res, next) => {
    const uuid = require("uuid");
    req.taskId = `export-task-${uuid.v4()}`;
    console.log("📥 收到上传请求，任务ID:", req.taskId);
    next();
  },
  upload.fields([
    { name: "design", maxCount: 1 },
    { name: "json", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "fonts", maxCount: 5 },
    { name: "preview", maxCount: 1 },
  ]),
  (req, res) => {
    const taskId = req.taskId;
    const exportDir = path.join(__dirname, "../exports", taskId);

    const designSvgPath = req.files["design"][0].path;
    const finalPdfPath = path.join(exportDir, "final.pdf");
    const previewPngPath = path.join(exportDir, "preview.png");

    console.log("📂 上传文件信息:", Object.keys(req.files));

    // 调用 Inkscape 转换 SVG 为 PDF
    exec(
      `inkscape "${designSvgPath}" --export-type=pdf --export-filename="${finalPdfPath}"`,
      (error, stdout, stderr) => {
        if (error) {
          console.error("Inkscape error:", stderr);
          return res
            .status(500)
            .json({ success: false, message: "Failed to generate PDF." });
        }

        console.log("✅ Inkscape PDF 转换完成:", finalPdfPath);

        // 可选：生成 preview.png（需要 sharp）
        // 已改成前端生成后，上传后端
        if (req.files["preview"]) {
          const previewFile = req.files["preview"][0];
          const previewTarget = path.join(exportDir, "preview.png");
          fs.renameSync(previewFile.path, previewTarget);
        }

        // ✅ CMYK 转换开始
        const cmykPdfPath = path.join(exportDir, "final-cmyk.pdf");
        exec(
          `gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -dColorConversionStrategy=/CMYK -dProcessColorModel=/DeviceCMYK -sOutputFile="${cmykPdfPath}" "${finalPdfPath}"`,
          (error2, stdout2, stderr2) => {
            if (error2) {
              console.warn("Ghostscript CMYK 转换失败：", stderr2);
              // 可忽略失败，仍返回原始 PDF
            }

            console.log("✅ Ghostscript CMYK PDF 完成:", cmykPdfPath);

            // ✅ 插入 zip 打包逻辑
            const zipPath = path.join(__dirname, "../exports", `${taskId}.zip`);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver("zip", { zlib: { level: 9 } });

            archive.pipe(output);

            output.on("close", () => {
              console.log(`✅ Zip 打包完成: ${archive.pointer()} bytes`);
              res.json({
                success: true,
                taskId,
                download: {
                  pdf: `/exports/${taskId}/final.pdf`,
                  cmyk: `/exports/${taskId}/final-cmyk.pdf`,
                  preview: `/exports/${taskId}/preview.png`,
                  svg: `/exports/${taskId}/design.svg`,
                  json: `/exports/${taskId}/data.json`,
                  zip: `/exports/${taskId}.zip`,
                },
              });
            });

            archive.on("error", (err) => {
              console.error("❌ Zip 打包失败:", err);
              res.status(500).json({ success: false, message: "ZIP 打包失败" });
            });

            archive.directory(
              path.join(__dirname, "../exports", taskId),
              `export-task-${taskId}`
            );
            archive.finalize();
          }
        );
      }
    );

    // 同时将 JSON 文件移入目录
    if (req.files["json"]) {
      const jsonFile = req.files["json"][0];
      const jsonTarget = path.join(exportDir, "data.json");
      fs.renameSync(jsonFile.path, jsonTarget);
    }
  }
);

module.exports = router;
