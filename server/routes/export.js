const ColorManager = require("./colorManager");
const colorManager = new ColorManager();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");

const router = express.Router();

// 🔧 替换你原有的convertToCMYKWithImageMagick函数
async function convertToCMYKWithImageMagick(
  inputPdf,
  outputPdf,
  iccProfilePath,
  targetDPI
) {
  console.log(`🎨 使用专业色彩管理转换CMYK，目标DPI: ${targetDPI}...`);

  // 使用ColorManager的专业转换
  const result = await colorManager.convertPDFToCMYKProfessional(
    inputPdf,
    outputPdf,
    {
      iccProfile: "Japan Color 2001 Coated",
      quality: 95,
      targetDPI: targetDPI, // 🔧 传递实际的DPI值
    }
  );

  // 保持与原有代码的兼容性
  if (!result.success) {
    console.error("❌ 专业CMYK转换失败:", result.error);
  }

  return result;
}

// 🔧 可选：增强图片预处理函数
async function preprocessUploadedImage(filePath, originalname) {
  try {
    const originalBuffer = fs.readFileSync(filePath);

    // 使用专业图片预处理
    const processedBuffer = await colorManager.preprocessImage(originalBuffer, {
      maxPixels: 50000000, // 🔧 从默认值改为50M像素，保持印刷质量
      processImage: true,
      targetColorSpace: "srgb",
    });

    // 如果图片被处理过，更新文件
    if (originalBuffer.length !== processedBuffer.length) {
      fs.writeFileSync(filePath, processedBuffer);
      console.log(`✅ 图片预处理完成: ${originalname}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`⚠️ 图片预处理失败: ${originalname}`, error);
    return false;
  }
}

// 保持你原有的storage和upload配置不变
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

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedPatterns = [
      "design",
      "json",
      "images",
      "fonts",
      "preview",
      /^region_\d+_(svg|json)$/,
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
      cb(null, false);
    }
  },
});

// 保持你原有的router配置
router.post(
  "/",
  (req, res, next) => {
    const uuid = require("uuid");
    req.taskId = `export-task-${uuid.v4()}`;
    console.log("📥 收到上传请求，任务ID:", req.taskId);
    next();
  },
  upload.any(),
  async (req, res) => {
    const taskId = req.taskId;
    const exportDir = path.join(__dirname, "../exports", taskId);
    const iccProfileName = req.body.iccProfile || "Japan Color 2001 Coated";
    const exportType = req.body.exportType || "single";

    console.log("🎨 导出类型:", exportType);
    console.log("🎨 ICC配置文件:", iccProfileName);

    // 文件分组处理
    const filesByField = {};
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach((file) => {
        if (!filesByField[file.fieldname]) {
          filesByField[file.fieldname] = [];
        }
        filesByField[file.fieldname].push(file);
      });
    }

    req.files = filesByField;
    console.log("📂 上传文件信息:", Object.keys(req.files));

    try {
      if (exportType === "multiRegion") {
        await handleMultiRegionExport(
          req,
          res,
          taskId,
          exportDir,
          iccProfileName
        );
      } else {
        await handleSingleRegionExport(
          req,
          res,
          taskId,
          exportDir,
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

// 🔧 简化处理函数，直接在这里实现，不需要EnhancedExporter
async function handleSingleRegionExport(
  req,
  res,
  taskId,
  exportDir,
  iccProfileName
) {
  if (!req.files["design"] || req.files["design"].length === 0) {
    throw new Error("设计文件缺失");
  }

  const designSvgPath = req.files["design"][0].path;
  const finalPdfPath = path.join(exportDir, "final.pdf");
  const cmykPdfPath = path.join(exportDir, "final-cmyk.pdf");

  console.log("📂 开始单区域导出处理...");

  // 🔧 新增：预处理上传的图片
  if (req.files["images"] && req.files["images"].length > 0) {
    console.log("🖼️ 预处理上传的图片...");
    for (const imageFile of req.files["images"]) {
      await preprocessUploadedImage(imageFile.path, imageFile.originalname);
    }
  }

  // SVG -> PDF 转换
  await new Promise((resolve, reject) => {
    exec(
      `inkscape "${designSvgPath}" --export-type=pdf --export-filename="${finalPdfPath}" --export-area-drawing`,
      (error, stdout, stderr) => {
        if (error) {
          console.error("Inkscape转换失败:", stderr);
          reject(new Error("SVG to PDF conversion failed"));
        } else {
          console.log("✅ Inkscape PDF转换完成");
          resolve();
        }
      }
    );
  });

  // 🔧 使用专业CMYK转换
  const cmykResult = await convertToCMYKWithImageMagick(
    finalPdfPath,
    cmykPdfPath,
    null, // 🔧 明确表示不使用外部ICC文件路径
    detectedDPI
  );

  // 处理其他文件
  if (req.files["json"] && req.files["json"].length > 0) {
    const jsonFile = req.files["json"][0];
    const jsonTarget = path.join(exportDir, "data.json");
    fs.renameSync(jsonFile.path, jsonTarget);
  }

  if (req.files["preview"]) {
    const previewFile = req.files["preview"][0];
    const previewTarget = path.join(exportDir, "preview.png");
    fs.renameSync(previewFile.path, previewTarget);
  }

  // 处理字体文件
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
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`✅ 拷贝字体: ${fontFile}`);
        }
      });
    });
  }

  // 创建ZIP
  const zipPath = path.join(__dirname, "../exports", `${taskId}.zip`);
  await createZipArchive(exportDir, zipPath);

  // 返回结果
  res.json({
    success: true,
    taskId,
    usedCMYK: cmykResult.usedCMYK,
    usedICC: cmykResult.usedICC,
    conversionMethod: cmykResult.method,
    iccProfile: iccProfileName,
    download: {
      pdf: `/exports/${taskId}/final.pdf`,
      cmyk: cmykResult.success ? `/exports/${taskId}/final-cmyk.pdf` : null,
      preview: `/exports/${taskId}/preview.png`,
      svg: `/exports/${taskId}/design.svg`,
      json: `/exports/${taskId}/data.json`,
      zip: `/exports/${taskId}.zip`,
    },
  });
}

async function handleMultiRegionExport(
  req,
  res,
  taskId,
  exportDir,
  iccProfileName
) {
  const regionCount = parseInt(req.body.regionCount) || 0;
  console.log(`🔢 处理 ${regionCount} 个区域的导出`);

  // 🔧 仅新增这三行获取DPI：
  const detectedDPI = parseInt(req.body.detectedDPI) || 72;
  const sourceRegion = req.body.sourceRegion;
  console.log(`📐 使用原始DPI: ${detectedDPI}, 来源区域: ${sourceRegion}`);

  const regionResults = [];
  const allConversionResults = [];

  // 🔧 预处理共享图片资源
  if (req.files["images"] && req.files["images"].length > 0) {
    console.log("🖼️ 预处理共享图片资源...");
    for (const imageFile of req.files["images"]) {
      await preprocessUploadedImage(imageFile.path, imageFile.originalname);
    }
  }

  // 处理每个区域
  for (let i = 0; i < regionCount; i++) {
    const regionSvgKey = `region_${i}_svg`;
    const regionJsonKey = `region_${i}_json`;
    const regionIdKey = `region_${i}_id`;

    const svgFiles = req.files[regionSvgKey];
    if (!svgFiles || svgFiles.length === 0 || !req.body[regionIdKey]) {
      console.warn(`⚠️ 区域 ${i} 数据不完整，跳过`);
      continue;
    }

    const regionId = req.body[regionIdKey];
    const svgFile = svgFiles[0];
    console.log(`📤 处理区域: ${regionId}`);

    // 创建区域目录
    const regionDir = path.join(exportDir, regionId);
    fs.mkdirSync(regionDir, { recursive: true });

    // 移动文件
    const regionSvgPath = path.join(regionDir, `${regionId}.svg`);
    fs.renameSync(svgFile.path, regionSvgPath);

    // 生成PDF
    const regionPdfPath = path.join(regionDir, `${regionId}.pdf`);
    const regionCmykPdfPath = path.join(regionDir, `${regionId}-cmyk.pdf`);

    try {
      // SVG -> PDF
      await new Promise((resolve, reject) => {
        const inkscapeCmd = `inkscape "${regionSvgPath}" --export-type=pdf --export-filename="${regionPdfPath}" --export-area-drawing --export-dpi=${detectedDPI}`;
        exec(inkscapeCmd, (error, stdout, stderr) => {
          if (error) {
            console.error(`❌ 区域 ${regionId} Inkscape转换失败:`, stderr);
            reject(error);
          } else {
            console.log(`✅ 区域 ${regionId} PDF转换完成`);
            resolve();
          }
        });
      });

      // 🔧 专业CMYK转换
      const cmykResult = await convertToCMYKWithImageMagick(
        regionPdfPath,
        regionCmykPdfPath,
        null, // 🔧 明确表示不使用外部ICC文件路径
        detectedDPI
      );
      allConversionResults.push(cmykResult);

      regionResults.push({
        regionId,
        success: true,
        conversionMethod: cmykResult.method,
        usedICC: cmykResult.usedICC,
        pdf: `/exports/${taskId}/${regionId}/${regionId}.pdf`,
        cmykPdf: cmykResult.success
          ? `/exports/${taskId}/${regionId}/${regionId}-cmyk.pdf`
          : null,
        svg: `/exports/${taskId}/${regionId}/${regionId}.svg`,
      });

      console.log(`✅ 区域 ${regionId} 处理完成，方法: ${cmykResult.method}`);
    } catch (error) {
      console.error(`❌ 区域 ${regionId} 处理失败:`, error);
      regionResults.push({
        regionId,
        success: false,
        error: error.message,
      });
    }
  }

  // 复制共享资源
  await copySharedResources(req, exportDir);

  // 处理预览图
  if (req.files["preview"]) {
    const previewFile = req.files["preview"][0];
    const previewTarget = path.join(exportDir, "preview.png");
    fs.renameSync(previewFile.path, previewTarget);
  }

  // 创建ZIP
  const zipPath = path.join(__dirname, "../exports", `${taskId}.zip`);
  await createZipArchive(exportDir, zipPath);

  // 分析整体结果
  const successfulConversions = allConversionResults.filter((r) => r.success);
  const methods = [...new Set(successfulConversions.map((r) => r.method))];

  res.json({
    success: true,
    taskId,
    exportType: "multiRegion",
    regionCount: regionResults.length,
    successfulRegions: regionResults.filter((r) => r.success).length,
    usedCMYK: successfulConversions.length > 0,
    usedICC: successfulConversions.some((r) => r.usedICC),
    conversionMethods: methods,
    iccProfile: iccProfileName,
    regions: regionResults,
    // 🔧 仅新增这个字段：
    dpiInfo: {
      detected: req.body.detectedDPI,
      used: detectedDPI,
      source: sourceRegion,
    },
    download: {
      zip: `/exports/${taskId}.zip`,
      preview: `/exports/${taskId}/preview.png`,
    },
  });
}

// 保持你原有的工具函数
async function copySharedResources(req, exportDir) {
  // 复制图片文件
  if (req.files["images"] && req.files["images"].length > 0) {
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });

    req.files["images"].forEach((imageFile) => {
      const targetPath = path.join(imagesDir, imageFile.originalname);
      fs.renameSync(imageFile.path, targetPath);
      console.log(`📷 复制预处理后的图片: ${imageFile.originalname}`);
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

function createZipArchive(exportDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    output.on("close", () => {
      console.log(`✅ Zip 打包完成: ${archive.pointer()} bytes`);
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
