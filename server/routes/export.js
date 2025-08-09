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

// 🔧 创建自定义文件过滤器，允许所有以特定前缀开头的字段
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // 允许的字段名模式
    const allowedPatterns = [
      "design",
      "json",
      "images",
      "fonts",
      "preview",
      /^region_\d+_(svg|json)$/, // 匹配 region_0_svg, region_1_json 等
    ];

    const isAllowed = allowedPatterns.some((pattern) => {
      if (typeof pattern === "string") {
        return file.fieldname === pattern;
      } else if (pattern instanceof RegExp) {
        return pattern.test(file.fieldname);
      }
      return false;
    });

    if (isAllowed) {
      cb(null, true);
    } else {
      console.warn(`⚠️ 未知字段: ${file.fieldname}`);
      cb(null, false); // 忽略未知字段，而不是抛出错误
    }
  },
});

router.post(
  "/",
  (req, res, next) => {
    const uuid = require("uuid");
    req.taskId = `export-task-${uuid.v4()}`;
    console.log("📥 收到上传请求，任务ID:", req.taskId);
    next();
  },
  // 🔧 使用 upload.any() 来接受所有符合过滤器的字段
  upload.any(),
  async (req, res) => {
    const taskId = req.taskId;
    const exportDir = path.join(__dirname, "../exports", taskId);
    const iccProfileName = req.body.iccProfile || "Japan Color 2001 Coated";
    const iccProfilePath = checkICCProfile(iccProfileName);
    const exportType = req.body.exportType || "single"; // 🆕 导出类型

    console.log("🎨 导出类型:", exportType);
    console.log("🎨 ICC配置文件:", iccProfileName);

    // 🔧 将 req.files 数组转换为按字段名分组的对象
    const filesByField = {};
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach((file) => {
        if (!filesByField[file.fieldname]) {
          filesByField[file.fieldname] = [];
        }
        filesByField[file.fieldname].push(file);
      });
    }

    // 🔧 将分组后的文件对象赋值给 req.files，保持原有代码兼容性
    req.files = filesByField;

    console.log("📂 上传文件信息:", Object.keys(req.files));

    try {
      if (exportType === "multiRegion") {
        await handleMultiRegionExport(
          req,
          res,
          taskId,
          exportDir,
          iccProfilePath,
          iccProfileName
        );
      } else {
        await handleSingleRegionExport(
          req,
          res,
          taskId,
          exportDir,
          iccProfilePath,
          iccProfileName
        );
      }
    } catch (error) {
      console.error("❌ 导出处理失败:", error);
      res.status(500).json({
        success: false,
        message: "导出处理失败",
        error: error.message,
      });
    }
  }
);

// 🆕 多区域导出处理函数
async function handleMultiRegionExport(
  req,
  res,
  taskId,
  exportDir,
  iccProfilePath,
  iccProfileName
) {
  const regionCount = parseInt(req.body.regionCount) || 0;
  console.log(`🔢 处理 ${regionCount} 个区域的导出`);

  const regionResults = [];
  const allConversionResults = [];

  // 处理每个区域
  for (let i = 0; i < regionCount; i++) {
    const regionSvgKey = `region_${i}_svg`;
    const regionJsonKey = `region_${i}_json`;
    const regionIdKey = `region_${i}_id`;

    // 🔧 修改文件访问方式
    const svgFiles = req.files[regionSvgKey];
    const jsonFiles = req.files[regionJsonKey];

    if (!svgFiles || svgFiles.length === 0 || !req.body[regionIdKey]) {
      console.warn(`⚠️ 区域 ${i} 数据不完整，跳过`);
      continue;
    }

    const regionId = req.body[regionIdKey];
    const svgFile = req.files[regionSvgKey][0];
    const jsonFile = req.files[regionJsonKey]
      ? req.files[regionJsonKey][0]
      : null;

    console.log(`📤 处理区域: ${regionId}`);

    // 创建区域专用目录
    const regionDir = path.join(exportDir, regionId);
    fs.mkdirSync(regionDir, { recursive: true });

    // 移动SVG文件到区域目录
    const regionSvgPath = path.join(regionDir, `${regionId}.svg`);
    fs.renameSync(svgFile.path, regionSvgPath);

    // 移动JSON文件到区域目录（如果存在）
    if (jsonFile) {
      const regionJsonPath = path.join(regionDir, `${regionId}.json`);
      fs.renameSync(jsonFile.path, regionJsonPath);
    }

    // 生成该区域的PDF
    const regionPdfPath = path.join(regionDir, `${regionId}.pdf`);
    const regionCmykPdfPath = path.join(regionDir, `${regionId}-cmyk.pdf`);

    try {
      // 使用 Inkscape 转换 SVG 为 PDF
      await new Promise((resolve, reject) => {
        exec(
          `inkscape "${regionSvgPath}" --export-type=pdf --export-filename="${regionPdfPath}" --export-area-drawing`,
          (error, stdout, stderr) => {
            if (error) {
              console.error(`❌ 区域 ${regionId} Inkscape 转换失败:`, stderr);
              reject(error);
            } else {
              console.log(`✅ 区域 ${regionId} PDF 转换完成:`, regionPdfPath);
              resolve();
            }
          }
        );
      });

      // 进行CMYK转换
      const cmykResult = await convertToCMYKWithImageMagick(
        regionPdfPath,
        regionCmykPdfPath,
        iccProfilePath
      );
      allConversionResults.push(cmykResult);

      regionResults.push({
        regionId,
        success: true,
        pdf: `/exports/${taskId}/${regionId}/${regionId}.pdf`,
        cmykPdf: cmykResult.success
          ? `/exports/${taskId}/${regionId}/${regionId}-cmyk.pdf`
          : null,
        svg: `/exports/${taskId}/${regionId}/${regionId}.svg`,
        json: jsonFile
          ? `/exports/${taskId}/${regionId}/${regionId}.json`
          : null,
      });

      console.log(`✅ 区域 ${regionId} 处理完成`);
    } catch (error) {
      console.error(`❌ 区域 ${regionId} 处理失败:`, error);
      regionResults.push({
        regionId,
        success: false,
        error: error.message,
      });
    }
  }

  // 🔧 复制共享资源（字体、图片）到根导出目录
  await copySharedResources(req, exportDir);

  // 生成预览图
  if (req.files["preview"]) {
    const previewFile = req.files["preview"][0];
    const previewTarget = path.join(exportDir, "preview.png");
    fs.renameSync(previewFile.path, previewTarget);
  }

  // 🔧 创建ZIP包
  const zipPath = path.join(__dirname, "../exports", `${taskId}.zip`);
  await createZipArchive(exportDir, zipPath);

  // 🔧 分析整体转换结果
  const successfulConversions = allConversionResults.filter((r) => r.success);
  const overallUsedCMYK = successfulConversions.length > 0;
  const overallUsedICC = successfulConversions.some((r) => r.usedICC);

  res.json({
    success: true,
    taskId,
    exportType: "multiRegion",
    regionCount: regionResults.length,
    successfulRegions: regionResults.filter((r) => r.success).length,
    usedCMYK: overallUsedCMYK,
    usedICC: overallUsedICC,
    iccProfile: iccProfileName,
    regions: regionResults,
    download: {
      zip: `/exports/${taskId}.zip`,
      preview: `/exports/${taskId}/preview.png`,
    },
  });
}

async function handleSingleRegionExport(
  req,
  res,
  taskId,
  exportDir,
  iccProfilePath,
  iccProfileName
) {
  // 🔧 修改文件访问方式
  if (!req.files["design"] || req.files["design"].length === 0) {
    throw new Error("设计文件缺失");
  }

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
  if (req.files["json"] && req.files["json"].length > 0) {
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

// 🔧 更新 copySharedResources 函数
async function copySharedResources(req, exportDir) {
  // 复制图片文件
  if (req.files["images"] && req.files["images"].length > 0) {
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });

    req.files["images"].forEach((imageFile) => {
      const targetPath = path.join(imagesDir, imageFile.originalname);
      fs.renameSync(imageFile.path, targetPath);
      console.log(`📷 复制图片: ${imageFile.originalname}`);
    });
  }

  // 复制字体文件
  if (req.files["fonts"] && req.files["fonts"].length > 0) {
    const fontsDir = path.join(exportDir, "fonts");
    fs.mkdirSync(fontsDir, { recursive: true });

    req.files["fonts"].forEach((fontFile) => {
      const targetPath = path.join(fontsDir, fontFile.originalname);
      fs.renameSync(fontFile.path, targetPath);
      console.log(`🔤 复制字体: ${fontFile.originalname}`);
    });
  }

  // 保存字体使用信息
  if (req.body.fontsUsed) {
    const fontsUsedPath = path.join(exportDir, "fonts-used.json");
    fs.writeFileSync(fontsUsedPath, req.body.fontsUsed);
  }
}

// 🆕 创建ZIP归档函数
function createZipArchive(exportDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    output.on("close", () => {
      console.log(`✅ 多区域 Zip 打包完成: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on("error", (err) => {
      console.error("❌ Zip 打包失败:", err);
      reject(err);
    });

    archive.directory(exportDir, path.basename(exportDir));
    archive.finalize();
  });
}

module.exports = router;
