const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");

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
    next();
  },
  upload.fields([
    { name: "design", maxCount: 1 },
    { name: "json", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "fonts", maxCount: 5 },
  ]),
  (req, res) => {
    const taskId = req.taskId;
    const exportDir = path.join(__dirname, "../exports", taskId);

    const designSvgPath = req.files["design"][0].path;
    const finalPdfPath = path.join(exportDir, "final.pdf");
    const previewPngPath = path.join(exportDir, "preview.png");

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

        // 可选：生成 preview.png（需要 sharp）
        // 暂略

        res.json({
          success: true,
          taskId,
          download: {
            pdf: `/exports/${taskId}/final.pdf`,
            preview: `/exports/${taskId}/preview.png`,
            svg: `/exports/${taskId}/design.svg`,
            json: `/exports/${taskId}/data.json`,
          },
        });
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
