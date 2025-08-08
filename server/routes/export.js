const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");

const router = express.Router();

// ICC配置文件路径配置
const ICC_PROFILES = {
  "Japan Color 2001 Coated": path.join(
    __dirname,
    "../icc-profiles/JapanColor2001Coated.icc"
  ),
};

// 检查ICC配置文件是否存在
function checkICCProfile(profileName) {
  const profilePath = ICC_PROFILES[profileName];
  if (!profilePath || !fs.existsSync(profilePath)) {
    console.warn(`⚠️ ICC配置文件不存在: ${profileName} -> ${profilePath}`);
    return null;
  }
  return profilePath;
}

// 检查ImageMagick可用性
function checkImageMagickAvailability() {
  return new Promise((resolve) => {
    // 优先尝试 magick 命令（ImageMagick v7）
    exec("magick -version", (error1) => {
      if (!error1) {
        resolve({ available: true, command: "magick" });
      } else {
        // 如果magick失败，再尝试 convert 命令（ImageMagick v6）
        exec("convert -version", (error2) => {
          if (!error2) {
            resolve({ available: true, command: "convert" });
          } else {
            resolve({ available: false, command: null });
          }
        });
      }
    });
  });
}

// 使用ImageMagick进行CMYK+ICC转换
function createImageMagickCommand(
  inputPdf,
  outputPdf,
  iccProfile = null,
  magickCmd = "convert"
) {
  // 检查输入文件是否存在
  if (!fs.existsSync(inputPdf)) {
    console.error(`❌ 输入PDF文件不存在: ${inputPdf}`);
    return null;
  }

  // 确保输出目录存在
  const outputDir = path.dirname(outputPdf);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 构建ImageMagick命令
  let command = `${magickCmd} "${inputPdf}" -colorspace cmyk`;

  // 添加质量和压缩设置
  command += ` -quality 95`;
  command += ` -compress zip`;

  if (iccProfile && fs.existsSync(iccProfile)) {
    command += ` -profile "${iccProfile}"`;
    console.log(`✅ 使用ICC配置文件: ${iccProfile}`);
  } else {
    if (iccProfile) {
      console.warn(`⚠️ ICC文件不存在: ${iccProfile}`);
    }
    console.log(`⚠️ 使用默认CMYK转换`);
  }

  command += ` "${outputPdf}"`;

  console.log(`📝 ImageMagick命令: ${command}`);
  return command;
}

// 增强的CMYK转换函数，包含回退机制
async function convertToCMYKWithImageMagick(
  inputPdf,
  outputPdf,
  iccProfile = null
) {
  return new Promise(async (resolve) => {
    // 检查ImageMagick可用性
    const magickInfo = await checkImageMagickAvailability();

    if (!magickInfo.available) {
      console.error("❌ ImageMagick不可用，请安装: brew install imagemagick");
      resolve({
        success: false,
        usedCMYK: false,
        usedICC: false,
        error: "ImageMagick not available",
      });
      return;
    }

    console.log(`✅ 使用ImageMagick命令: ${magickInfo.command}`);

    // 如果提供了ICC文件，先验证
    if (iccProfile && !fs.existsSync(iccProfile)) {
      console.warn(`⚠️ ICC文件不存在，将使用标准CMYK转换: ${iccProfile}`);
      iccProfile = null;
    }

    const cmykCommand = createImageMagickCommand(
      inputPdf,
      outputPdf,
      iccProfile,
      magickInfo.command
    );

    if (!cmykCommand) {
      resolve({
        success: false,
        usedCMYK: false,
        usedICC: false,
        error: "Command creation failed",
      });
      return;
    }

    console.log("🔄 执行ImageMagick CMYK转换...");

    exec(cmykCommand, (error, stdout, stderr) => {
      if (error) {
        console.warn("第一次转换失败，尝试不使用ICC的回退方案:", stderr);

        // 回退方案：不使用ICC配置文件
        const fallbackCommand = createImageMagickCommand(
          inputPdf,
          outputPdf,
          null,
          magickInfo.command
        );

        exec(
          fallbackCommand,
          (fallbackError, fallbackStdout, fallbackStderr) => {
            if (fallbackError) {
              console.error("❌ 回退转换也失败:", fallbackStderr);
              resolve({
                success: false,
                usedCMYK: false,
                usedICC: false,
                error: `ImageMagick conversion failed: ${fallbackStderr}`,
              });
            } else {
              console.log("✅ 回退CMYK转换成功（无ICC）");
              resolve({
                success: true,
                usedCMYK: true,
                usedICC: false,
                method: "ImageMagick fallback",
              });
            }
          }
        );
      } else {
        const usedICC = iccProfile !== null;
        console.log("✅ ImageMagick CMYK转换成功");
        if (usedICC) {
          console.log("✅ ICC配置文件已应用");
        }
        resolve({
          success: true,
          usedCMYK: true,
          usedICC,
          method: "ImageMagick with ICC",
        });
      }
    });
  });
}

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
    const iccProfileName = req.body.iccProfile || "Japan Color 2001 Coated";
    const iccProfilePath = checkICCProfile(iccProfileName);
    console.log("🎨 ICC配置文件:", iccProfileName);
    const designSvgPath = req.files["design"][0].path;
    const finalPdfPath = path.join(exportDir, "final.pdf");
    const previewPngPath = path.join(exportDir, "preview.png");

    console.log("📂 上传文件信息:", Object.keys(req.files));

    // 调用 Inkscape 转换 SVG 为 PDF
    exec(
      `inkscape "${designSvgPath}" --export-type=pdf --export-filename="${finalPdfPath}" --export-area-drawing`,
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

        convertToCMYKWithImageMagick(finalPdfPath, cmykPdfPath, iccProfilePath)
          .then((result) => {
            const { success, usedCMYK, usedICC, method, error } = result;

            if (!success) {
              console.error("❌ CMYK转换失败:", error);
              // 可以选择不生成CMYK文件，只返回原PDF，或者返回错误
            } else {
              console.log(`✅ CMYK转换成功，方法: ${method}`);
            }

            // 继续处理ZIP打包...
            const zipPath = path.join(__dirname, "../exports", `${taskId}.zip`);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver("zip", { zlib: { level: 9 } });

            archive.pipe(output);

            output.on("close", () => {
              console.log(`✅ Zip 打包完成: ${archive.pointer()} bytes`);
              res.json({
                success: true,
                taskId,
                usedCMYK,
                usedICC,
                conversionMethod: method || "Unknown",
                iccProfile: iccProfileName,
                download: {
                  pdf: `/exports/${taskId}/final.pdf`,
                  cmyk: success ? `/exports/${taskId}/final-cmyk.pdf` : null,
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
          })
          .catch((err) => {
            console.error("❌ 转换过程出错:", err);
            res.status(500).json({ success: false, message: "CMYK转换失败" });
          });
      }
    );

    // 同时将 JSON 文件移入目录
    if (req.files["json"]) {
      const jsonFile = req.files["json"][0];
      const jsonTarget = path.join(exportDir, "data.json");
      fs.renameSync(jsonFile.path, jsonTarget);
    }

    if (req.body.fontsUsed) {
      const fontsUsed = JSON.parse(req.body.fontsUsed);
      const fontsSourceDir = path.join(__dirname, "../public/fonts");
      const fontsTargetDir = path.join(exportDir, "fonts");
      fs.mkdirSync(fontsTargetDir, { recursive: true });

      fontsUsed.forEach((fontName) => {
        const fontFiles = fs
          .readdirSync(fontsSourceDir)
          .filter((f) => f.startsWith(fontName));
        fontFiles.forEach((fontFile) => {
          const src = path.join(fontsSourceDir, fontFile);
          const dest = path.join(fontsTargetDir, fontFile);
          fs.copyFileSync(src, dest);
          console.log(`✅ 拷贝字体: ${fontFile}`);
        });
      });
    }
  }
);

module.exports = router;
