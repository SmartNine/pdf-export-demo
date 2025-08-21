const sharp = require("sharp");
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

async function convertToCMYKWithImageMagick(
  inputPdf,
  outputPdf,
  iccProfileName,
  targetDPI
) {
  console.log(
    `🎨 开始专业CMYK转换，目标DPI: ${targetDPI}，ICC: ${iccProfileName}`
  );

  const actualProfileName = iccProfileName || "Japan Color 2001 Coated";

  const result = await colorManager.convertPDFToCMYKProfessional(
    inputPdf,
    outputPdf,
    {
      iccProfile: actualProfileName,
      quality: 95,
      targetDPI: targetDPI,
    }
  );

  // 🔧 新增：验证转换结果
  if (result.success) {
    try {
      console.log("🔍 验证转换后的PDF色彩空间...");
      const validation = await colorManager.validateColorSpace(outputPdf);

      // 🔧 新增：矢量内容验证
      console.log("📐 验证PDF矢量内容完整性...");
      const vectorValidation = await colorManager.validatePDFVectorContent(
        outputPdf
      );

      if (vectorValidation.isVector) {
        console.log("✅ PDF保持矢量特性");
        result.isVector = true;
        result.hasText = vectorValidation.hasText;
        result.fileSize = `${vectorValidation.fileSize}KB`;

        if (vectorValidation.details.isSuspiciouslyLarge) {
          console.warn("⚠️ 文件大小异常，可能部分栅格化");
          result.sizeWarning = "文件大小较大，建议检查是否完全矢量化";
        }
      } else {
        console.warn("❌ PDF可能已被栅格化");
        result.isVector = false;
        result.vectorWarning = "PDF可能被栅格化，建议检查转换参数";
      }

      // 🔧 新增：像素级验证
      console.log("🔬 进行像素级色彩验证...");
      const pixelValidation = await colorManager.validateColorSpaceByPixel(
        outputPdf
      );
      // 🔧 新增：检查是否为预期的CMYK颜色值范围
      if (pixelValidation.success && pixelValidation.pixelValue) {
        const isCMYKFormat = pixelValidation.pixelValue.includes("cmyk(");
        const pixelValue = pixelValidation.pixelValue;

        console.log(`🎨 像素级验证: ${pixelValue}`);

        // 🔧 检测颜色是否在正常CMYK范围内
        if (isCMYKFormat) {
          const cmykMatch = pixelValue.match(/cmyk\((\d+),(\d+),(\d+),(\d+)\)/);
          if (cmykMatch) {
            const [, c, m, y, k] = cmykMatch.map(Number);

            // 🔧 检查是否为异常的CMYK值（如测试中的错误值）
            const isAbnormalCMYK =
              (c === 75 && m === 81 && y === 98 && k === 66) || // 已知错误值
              (c > 90 && m > 90 && y > 90 && k > 60); // 过度饱和的值

            if (isAbnormalCMYK) {
              console.error(
                "❌ 检测到异常CMYK值，可能是Ghostscript污染:",
                pixelValue
              );
              result.conversionWarning = "检测到异常CMYK值，建议检查转换流程";
              result.colorValidationFailed = true;
            } else {
              console.log("✅ CMYK值正常，转换成功");
              result.colorValidationPassed = true;
            }
          }
        }
      }

      if (pixelValidation.success) {
        console.log(`✅ 像素级验证: ${pixelValidation.colorSpace}`);
        console.log(`🎨 样本像素值: ${pixelValidation.pixelValue}`);

        result.pixelValidation = {
          colorSpace: pixelValidation.colorSpace,
          samplePixel: pixelValidation.pixelValue,
          confidence: pixelValidation.confidence,
        };
      }

      if (validation.success) {
        console.log(
          `✅ 验证结果: ${validation.colorSpace} (置信度: ${(
            validation.confidence * 100
          ).toFixed(1)}%)`
        );

        result.validatedColorSpace = validation.colorSpace;
        result.validationConfidence = validation.confidence;
        result.validationSummary = validation.summary;

        if (validation.colorSpace !== "CMYK") {
          console.warn("⚠️ 警告：PDF仍为RGB色彩空间，可能需要检查ICC配置");
          result.conversionWarning = "转换后仍为RGB色彩空间";
        }
      }
    } catch (validationError) {
      console.warn("⚠️ 验证失败:", validationError.message);
    }
  }

  return result;
}

async function preprocessUploadedImage(filePath, originalname, options = {}) {
  const {
    isPrintMode = true, // tradeshow展品默认为印刷模式
    preserveOriginal = true,
    maxQuality = 98,
  } = options;

  try {
    const originalBuffer = fs.readFileSync(filePath);

    // 🔧 保存原始图片副本
    const uploadsDir = path.dirname(filePath);
    const originalDir = path.join(uploadsDir, "originals");
    fs.mkdirSync(originalDir, { recursive: true });

    const originalBackupPath = path.join(originalDir, originalname);
    fs.writeFileSync(originalBackupPath, originalBuffer);
    console.log(`💾 原始图片已备份: ${originalname}`);

    // 🔧 检测图片信息
    const metadata = await sharp(originalBuffer).metadata();
    console.log(
      `📷 图片信息: ${metadata.width}x${metadata.height}, 格式:${metadata.format}, 色彩空间:${metadata.space}`
    );

    // 🔧 印刷模式下的智能处理策略
    if (isPrintMode) {
      console.log("🎨 印刷模式：优先保证色彩质量");

      // CMYK图片需要专业转换，但保持高质量
      if (metadata.format === "jpeg" && metadata.space === "cmyk") {
        console.log("🎨 CMYK图片专业转换（保持高质量）");
        const processedBuffer =
          await colorManager.convertCMYKImageProfessionally(originalBuffer);

        // 🔧 验证转换后的质量
        const processedMetadata = await sharp(processedBuffer).metadata();
        console.log(
          `✅ CMYK转换完成: ${processedMetadata.width}x${processedMetadata.height}, 色彩空间:${processedMetadata.space}`
        );

        // 保存高质量转换版本
        fs.writeFileSync(filePath, processedBuffer);

        return {
          processed: true,
          hasOriginalBackup: true,
          originalPath: originalBackupPath,
          conversionType: "CMYK_TO_RGB_HIGH_QUALITY",
          qualityPreserved: true,
          // 🔧 新增：标记这是CMYK转换的图片
          wasCMYKImage: true,
          shouldUseProcessedVersion: true,
        };
      }

      // RGB图片：检查是否需要处理
      const fileSize = originalBuffer.length;
      const isVeryLarge = fileSize > 10 * 1024 * 1024; // 10MB以上

      if (isVeryLarge || metadata.width > 8000 || metadata.height > 8000) {
        console.log("📏 超大图片，进行适度优化但保持印刷质量");

        const processedBuffer = await colorManager.preprocessImage(
          originalBuffer,
          {
            maxPixels: 50000000, // 提高像素限制
            processImage: true,
            targetColorSpace: "srgb",
            quality: maxQuality, // 使用最高质量
            preserveForPrint: true,
          }
        );

        fs.writeFileSync(filePath, processedBuffer);

        return {
          processed: true,
          hasOriginalBackup: true,
          originalPath: originalBackupPath,
          conversionType: "SIZE_OPTIMIZATION_PRINT_QUALITY",
          qualityPreserved: true,
        };
      } else {
        console.log("✅ 图片尺寸适中，保持原始质量");
        // 直接使用原始文件，不进行任何处理
        return {
          processed: false,
          hasOriginalBackup: true,
          originalPath: originalBackupPath,
          conversionType: "NO_PROCESSING_ORIGINAL_QUALITY",
          qualityPreserved: true,
        };
      }
    }

    // 非印刷模式使用原有逻辑
    const processedBuffer = await colorManager.preprocessImage(originalBuffer, {
      maxPixels: 15000,
      processImage: true,
      targetColorSpace: "srgb",
    });

    fs.writeFileSync(filePath, processedBuffer);

    return {
      processed: true,
      hasOriginalBackup: true,
      originalPath: originalBackupPath,
      conversionType: "STANDARD_WEB_QUALITY",
    };
  } catch (error) {
    console.error(`⚠️ 图片预处理失败: ${originalname}`, error);
    return { processed: false, hasOriginalBackup: false, error: error.message };
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

  // 🔧 预处理共享图片资源时指定为印刷模式
  if (req.files["images"] && req.files["images"].length > 0) {
    console.log("🖼️ 预处理共享图片资源（印刷质量模式）...");
    for (const imageFile of req.files["images"]) {
      const result = await preprocessUploadedImage(
        imageFile.path,
        imageFile.originalname,
        {
          isPrintMode: true, // 🔧 tradeshow展品使用印刷模式
          preserveOriginal: true, // 🔧 保留原始文件
          maxQuality: 98, // 🔧 最高质量
        }
      );

      console.log(`📊 ${imageFile.originalname} 处理结果:`, result);
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
        let inkscapeCmd = `inkscape "${regionSvgPath}"`;
        inkscapeCmd += ` --export-type=pdf`;
        inkscapeCmd += ` --export-filename="${regionPdfPath}"`;
        inkscapeCmd += ` --export-area-drawing`;
        inkscapeCmd += ` --export-dpi=${detectedDPI}`;
        inkscapeCmd += ` --export-pdf-version=1.4`;
        // inkscapeCmd += ` --export-text-to-path=false`;

        console.log(`📝 svg2pdf的inkscape命令: ${inkscapeCmd}`);

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

      // 🔧 新增：验证该区域原始PDF矢量特性
      console.log(`📐 验证区域 ${regionId} 原始PDF矢量特性...`);
      const originalVectorValidation =
        await colorManager.validatePDFVectorContent(regionPdfPath);

      console.log(`🔍 区域 ${regionId} 原始PDF验证结果:`, {
        isVector: originalVectorValidation.isVector,
        hasText: originalVectorValidation.hasText,
        hasVectorGraphics: originalVectorValidation.hasVectorGraphics,
        fileSize: `${originalVectorValidation.fileSize}KB`,
        fontCount: originalVectorValidation.details.fontCount,
      });

      if (!originalVectorValidation.isVector) {
        console.error(`❌ 区域 ${regionId} Inkscape生成的PDF已被栅格化！`);
      } else {
        console.log(`✅ 区域 ${regionId} 原始PDF保持矢量特性`);
      }

      // 🔧 专业CMYK转换
      const cmykResult = await convertToCMYKWithImageMagick(
        regionPdfPath,
        regionCmykPdfPath,
        iccProfileName,
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

  // 🔧 新增：聚合矢量验证信息
  const vectorResults = successfulConversions.filter(
    (r) => r.isVector !== undefined
  );
  const allVector =
    vectorResults.length > 0 && vectorResults.every((r) => r.isVector);
  const hasVectorWarnings = successfulConversions.some(
    (r) => r.vectorWarning || r.sizeWarning
  );

  res.json({
    success: true,
    taskId,
    exportType: "multiRegion",
    regionCount: regionResults.length,
    successfulRegions: regionResults.filter((r) => r.success).length,
    usedCMYK: successfulConversions.length > 0,
    usedICC: successfulConversions.some((r) => r.usedICC),
    conversionMethods: methods,
    // 🔧 新增矢量验证信息：
    isVector: allVector,
    vectorRegions: vectorResults.length,
    hasVectorWarnings: hasVectorWarnings,
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
  // 复制图片文件时，同时复制原始版本
  if (req.files["images"] && req.files["images"].length > 0) {
    const imagesDir = path.join(exportDir, "images");
    const originalsDir = path.join(imagesDir, "originals");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(originalsDir, { recursive: true });

    req.files["images"].forEach((imageFile) => {
      // 复制处理后的图片（备用）
      const targetPath = path.join(imagesDir, imageFile.originalname);
      fs.renameSync(imageFile.path, targetPath);

      // 🔧 复制原始图片
      const originalBackupPath = path.join(
        path.dirname(imageFile.path),
        "originals",
        imageFile.originalname
      );
      if (fs.existsSync(originalBackupPath)) {
        const originalTargetPath = path.join(
          originalsDir,
          imageFile.originalname
        );
        fs.copyFileSync(originalBackupPath, originalTargetPath);
        console.log(`📁 复制原始图片: ${imageFile.originalname}`);
      }

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
