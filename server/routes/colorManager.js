// colorManager.js - 借鉴canvas.js的专业色彩处理
const fs = require("fs");
const path = require("path");
const { exec, spawnSync } = require("child_process");
const sharp = require("sharp");

class ColorManager {
  constructor() {
    // 🔧 根据你的实际目录结构配置ICC文件路径
    this.ICC_PROFILES = {
      "Japan Color 2001 Coated": path.join(
        __dirname,
        "../icc-profiles/JapanColor2001Coated.icc"
      ),
      sRGB: path.join(__dirname, "../icc-profiles/sRGB.icc"),
      "US Web Coated SWOP": path.join(
        __dirname,
        "../icc-profiles/USWebCoatedSWOP.icc"
      ),
    };

    // 默认使用的配置文件
    this.defaultCMYKProfile = "Japan Color 2001 Coated";
    this.defaultRGBProfile = "sRGB";

    this.availableTools = null;
  }

  // 🔧 移植：检查ICC配置文件
  checkICCProfile(profileName) {
    const profilePath = this.ICC_PROFILES[profileName];
    if (!profilePath || !fs.existsSync(profilePath)) {
      console.warn(`⚠️ ICC配置文件不存在: ${profileName} -> ${profilePath}`);
      return null;
    }
    return profilePath;
  }

  // 🔧 移植：检查色彩处理工具可用性
  async checkColorTools() {
    if (this.availableTools) return this.availableTools;

    const tools = {
      jpgicc: await this.checkTool("jpgicc -v"),
      imagemagick: await this.checkImageMagickVersion(),
      ghostscript: await this.checkTool("gs --version"),
    };

    this.availableTools = tools;
    console.log(
      "🎨 可用色彩工具:",
      Object.entries(tools)
        .filter(([, available]) => available)
        .map(([tool]) => tool)
        .join(", ")
    );

    return tools;
  }

  async checkTool(command) {
    return new Promise((resolve) => {
      exec(command, (error) => {
        resolve(!error);
      });
    });
  }

  // 🔧 移植canvas.js的ImageMagick版本检测
  async checkImageMagickVersion() {
    return new Promise((resolve) => {
      exec("magick -version", (error1) => {
        if (!error1) {
          resolve({ available: true, command: "magick", version: 7 });
        } else {
          exec("convert -version", (error2) => {
            resolve({
              available: !error2,
              command: error2 ? null : "convert",
              version: error2 ? null : 6,
            });
          });
        }
      });
    });
  }

  // 🔧 移植：专业图片预处理（从canvas.js）
  async preprocessImage(imageBuffer, options = {}) {
    const {
      maxPixels = 15000,
      processImage = true,
      targetColorSpace = "srgb",
    } = options;

    if (!processImage) return imageBuffer;

    try {
      let context = sharp(imageBuffer, { limitInputPixels: false });
      const { format, space, orientation, width, height } =
        await context.metadata();

      console.log(
        `📷 处理图片: ${width}x${height}, 格式:${format}, 色彩空间:${space}`
      );

      // 🔧 移植：CMYK图片特殊处理
      if (format === "jpeg" && space === "cmyk") {
        console.log("🎨 检测到CMYK图片，需要专业转换");
        context = await this.convertCMYKImageProfessionally(
          context,
          imageBuffer
        );
      }

      // 🔧 移植：尺寸限制处理
      if (width > maxPixels || height > maxPixels) {
        console.log(`📏 图片尺寸超限，缩放到${maxPixels}px以内`);
        context = context.resize(maxPixels, maxPixels, { fit: "inside" });
      }

      // 🔧 移植：EXIF旋转处理
      if (orientation && orientation !== 1) {
        console.log(`🔄 应用EXIF旋转: ${orientation}`);
        context = this.handleExifOrientation(context, orientation);
      }

      return await context.toBuffer();
    } catch (error) {
      console.error("❌ 图片预处理失败:", error);
      return imageBuffer; // 返回原始数据作为兜底
    }
  }

  // 🔧 移植canvas.js的CMYK处理逻辑
  // 在 colorManager.js 中添加
  async convertCMYKImageProfessionally(imageBuffer) {
    const { format, space } = await sharp(imageBuffer).metadata();

    if (format === "jpeg" && space === "cmyk") {
      console.log("🎨 检测到CMYK图片，使用jpgicc专业转换");

      const tmpDir = require("os").tmpdir();
      const inputPath = path.join(tmpDir, `cmyk_input_${Date.now()}.jpg`);
      const outputPath = path.join(tmpDir, `srgb_output_${Date.now()}.jpg`);

      try {
        // 写入临时文件
        fs.writeFileSync(inputPath, imageBuffer);

        // 🔧 使用您现有的ICC文件
        const cmykProfile = this.checkICCProfile("Japan Color 2001 Coated");
        const srgbProfile = this.checkICCProfile("sRGB");

        const jpgiccArgs = [
          "-i",
          cmykProfile, // 输入：日本印刷标准
          "-o",
          srgbProfile, // 输出：sRGB标准
          inputPath,
          outputPath,
        ];

        const result = spawnSync("jpgicc", jpgiccArgs);

        if (result.error) {
          throw new Error(`jpgicc转换失败: ${result.stderr?.toString()}`);
        }

        const convertedBuffer = fs.readFileSync(outputPath);
        console.log("✅ jpgicc CMYK→sRGB转换成功");

        return convertedBuffer;
      } finally {
        // 清理临时文件
        [inputPath, outputPath].forEach((file) => {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        });
      }
    }

    return imageBuffer; // 非CMYK图片直接返回
  }

  // 🔧 移植canvas.js的jpgicc处理（简化版）
  async convertCMYKWithJpgicc(imageBuffer) {
    const tmpDir = require("os").tmpdir();
    const inputPath = path.join(tmpDir, `cmyk_input_${Date.now()}.jpg`);
    const outputPath = path.join(tmpDir, `srgb_output_${Date.now()}.jpg`);

    try {
      // 写入临时文件
      fs.writeFileSync(inputPath, imageBuffer);

      // 🔧 简化：只使用必需的配置文件
      const cmykProfile = this.checkICCProfile("Japan Color 2001 Coated");

      // 🔧 如果没有sRGB配置文件，让jpgicc使用内置配置
      const srgbProfile = this.checkICCProfile("sRGB");

      let jpgiccArgs;
      if (cmykProfile && srgbProfile) {
        // 完整配置：指定输入和输出配置文件
        jpgiccArgs = [
          "-i",
          cmykProfile,
          "-o",
          srgbProfile,
          inputPath,
          outputPath,
        ];
      } else if (cmykProfile) {
        // 简化配置：只指定输入配置文件，输出使用内置sRGB
        jpgiccArgs = ["-i", cmykProfile, inputPath, outputPath];
      } else {
        // 最简配置：使用jpgicc内置配置文件
        jpgiccArgs = [inputPath, outputPath];
      }

      const result = spawnSync("jpgicc", jpgiccArgs);

      if (result.error) {
        throw new Error(`jpgicc转换失败: ${result.stderr?.toString()}`);
      }

      const convertedBuffer = fs.readFileSync(outputPath);
      console.log("✅ jpgicc CMYK转换成功");

      return convertedBuffer;
    } finally {
      // 清理临时文件
      [inputPath, outputPath].forEach((file) => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    }
  }

  // 🔧 移植：EXIF方向处理
  handleExifOrientation(context, orientation) {
    switch (orientation) {
      case 8:
        return context.rotate(-90);
      case 3:
        return context.rotate(180);
      case 6:
        return context.rotate(90);
      default:
        return context;
    }
  }

  // 🔧 新增：增强的CMYK PDF转换
  async convertPDFToCMYKProfessional(inputPdf, outputPdf, options = {}) {
    const {
      iccProfile = "Japan Color 2001 Coated",
      quality = 95,
      method = "auto",
      targetDPI, // 🔧 确保这里也有 targetDPI 参数
    } = options;

    // 🔧 添加参数验证
    if (!targetDPI || targetDPI <= 0) {
      throw new Error(`targetDPI参数无效: ${targetDPI}，必须传入有效的DPI值`);
    }

    console.log(
      `🎨 专业CMYK转换: ${iccProfile}, 质量: ${quality}, DPI: ${targetDPI}`
    );

    const tools = await this.checkColorTools();
    const profilePath = this.checkICCProfile(iccProfile);

    // 🔧 调整转换优先级，ImageMagick在有ICC支持的情况下更可靠
    const conversionMethods = [
      () =>
        this.convertWithImageMagick(
          inputPdf,
          outputPdf,
          profilePath,
          quality,
          targetDPI
        ), // 🔧 首选：有ICC支持
      () =>
        this.convertWithGhostscript(inputPdf, outputPdf, quality, targetDPI), // 备选：基础CMYK
    ];

    for (const convertMethod of conversionMethods) {
      try {
        const result = await convertMethod();
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.warn("转换方法失败，尝试下一个方法:", error.message);
      }
    }

    return {
      success: false,
      error: "所有CMYK转换方法都失败了",
      usedCMYK: false,
      usedICC: false,
    };
  }

  // 🔧 改进：ImageMagick CMYK转换 - 保持图像清晰度
  async convertWithImageMagick(
    inputPdf,
    outputPdf,
    iccProfile,
    quality,
    targetDPI = 72
  ) {
    const magickInfo = this.availableTools.imagemagick;
    if (!magickInfo.available) {
      throw new Error("ImageMagick不可用");
    }

    let command = `${magickInfo.command} -density ${targetDPI} "${inputPdf}"`;

    // 🔧 使用明确的ICC文件路径，避免动态查找
    const srgbProfile = path.join(__dirname, "../icc-profiles/sRGB.icc");
    const cmykProfile = path.join(
      __dirname,
      "../icc-profiles/JapanColor2001Coated.icc"
    );

    // 🔧 在现有命令基础上，增加强制CMYK元数据写入
    if (fs.existsSync(srgbProfile) && fs.existsSync(cmykProfile)) {
      console.log("✅ 使用固定ICC配置文件路径");
      command += ` -profile "${srgbProfile}"`;
      command += ` -profile "${cmykProfile}"`;
      command += ` -colorspace CMYK`;
      command += ` -define pdf:use-cmyk=true`;

      // 🔧 新增：强制写入CMYK元数据
      command += ` -set colorspace CMYK`;
      command += ` -define pdf:colorspace=cmyk`;
      command += ` -define pdf:compression=jpeg`;
      command += ` -define pdf:preserve-colorspace=true`;
      command += ` -type ColorSeparation`; // 强制色彩分离模式
    } else {
      console.warn("⚠️ ICC配置文件不存在，使用基础转换");
      command += ` -colorspace CMYK`;
      command += ` -set colorspace CMYK`;
      command += ` -define pdf:use-cmyk=true`;
    }

    // 保持原有的高质量设置
    command += ` -intent Perceptual`;
    command += ` -quality ${quality}`;
    command += ` -compress jpeg`;
    command += ` -density ${targetDPI}`;
    command += ` "${outputPdf}"`;

    console.log(`📝 高质量ImageMagick命令: ${command}`);

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.warn(`ImageMagick主要方法失败: ${stderr}`);
          // 🔧 回退到基础方法
          this.convertWithImageMagickBasic(
            inputPdf,
            outputPdf,
            iccProfile,
            quality
          )
            .then(resolve)
            .catch(reject);
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: iccProfile !== null,
            method: "ImageMagick High-Quality",
          });
        }
      });
    });
  }

  // 🔧 新增：基础回退方法
  async convertWithImageMagickBasic(inputPdf, outputPdf, iccProfile, quality) {
    const magickInfo = this.availableTools.imagemagick;

    let command = `${magickInfo.command} "${inputPdf}" -colorspace cmyk -quality ${quality}`;

    if (iccProfile && fs.existsSync(iccProfile)) {
      command += ` -profile "${iccProfile}"`;
    }

    command += ` "${outputPdf}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ImageMagick基础转换失败: ${stderr}`));
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: iccProfile !== null,
            method: "ImageMagick Basic",
          });
        }
      });
    });
  }

  // 🔧 移植：PDF专用的jpgicc处理
  async convertWithJpgicc(inputPdf, outputPdf, iccProfile) {
    if (!iccProfile) {
      throw new Error("jpgicc需要ICC配置文件");
    }

    const command = `jpgicc -i "${iccProfile}" "${inputPdf}" "${outputPdf}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`jpgicc转换失败: ${stderr}`));
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: true,
            method: "jpgicc",
          });
        }
      });
    });
  }

  async convertWithGhostscript(inputPdf, outputPdf, quality, targetDPI = 72) {
    // 🔧 针对无ICC支持的Ghostscript简化命令
    let command = `gs -sDEVICE=pdfwrite -dNOPAUSE -dBATCH -dSAFER`;
    command += ` -dCompatibilityLevel=1.4`;

    // 🔧 只使用基础CMYK设置，不涉及ICC
    command += ` -dColorConversionStrategy=CMYK`;
    command += ` -dProcessColorModel=/DeviceCMYK`;
    command += ` -dConvertCMYKImagesToRGB=false`;
    command += ` -dConvertImagesToIndexed=false`;

    // 🔧 移除所有ICC相关参数
    // ❌ command += ` -sDefaultCMYKProfile="${japanProfile}"`;  // 这会失败
    // ❌ command += ` -sOutputICCProfile="${japanProfile}"`;     // 这会失败

    // 基础图像设置
    command += ` -dColorImageResolution=${targetDPI}`;
    command += ` -dGrayImageResolution=${targetDPI}`;
    command += ` -dAutoFilterColorImages=false`;
    command += ` -dColorImageFilter=/DCTEncode`;
    command += ` -dColorImageDict='<< /Quality ${quality} >>'`;

    command += ` -sOutputFile="${outputPdf}" "${inputPdf}"`;

    console.log(`📝 基础Ghostscript命令(无ICC): ${command}`);

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Ghostscript错误: ${error.message}`);
          console.error(`❌ stderr: ${stderr}`);
          reject(new Error(`Ghostscript转换失败: ${stderr || error.message}`));
        } else {
          console.log(`✅ Ghostscript基础CMYK转换成功`);
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: false, // 🔧 明确标记未使用ICC
            method: "Ghostscript Basic CMYK",
          });
        }
      });
    });
  }

  async validateColorSpace(pdfPath) {
    console.log(`🔍 开始验证PDF色彩空间: ${pdfPath}`);

    const validationMethods = [
      {
        name: "pixel-analysis",
        method: () => this.validateColorSpaceByPixel(pdfPath),
      }, // 🔧 新增首选验证
      { name: "exiftool", method: () => this.validateWithExiftool(pdfPath) },
      { name: "identify", method: () => this.validateWithIdentify(pdfPath) },
      {
        name: "ghostscript",
        method: () => this.validateWithGhostscript(pdfPath),
      },
    ];

    const results = [];

    for (const { name, method } of validationMethods) {
      try {
        console.log(`🔍 尝试验证方法: ${name}`);
        const result = await method();
        if (result.success && !isNaN(result.confidence)) {
          // 🔧 检查NaN
          results.push({ method: name, ...result });
          console.log(
            `✅ ${name} 验证成功: ${result.colorSpace} (置信度: ${(
              result.confidence * 100
            ).toFixed(1)}%)`
          );
        }
      } catch (error) {
        console.warn(`⚠️ ${name} 验证失败:`, error.message);
      }
    }

    if (results.length === 0) {
      return { success: false, error: "所有验证方法都失败了" };
    }

    // 🔧 改进权重计算，处理NaN情况
    const weightedResults = results.map((r) => ({
      ...r,
      weight: r.method === "exiftool" ? 2.0 : 1.0,
      confidence: isNaN(r.confidence) ? 0.5 : r.confidence, // 🔧 处理NaN
    }));

    const totalWeight = weightedResults.reduce((sum, r) => sum + r.weight, 0);
    const weightedConfidence =
      weightedResults.reduce((sum, r) => sum + r.confidence * r.weight, 0) /
      totalWeight;

    const cmykResults = weightedResults.filter((r) => r.colorSpace === "CMYK");
    const cmykWeight = cmykResults.reduce((sum, r) => sum + r.weight, 0);
    const isCMYK = cmykWeight > totalWeight / 2;

    return {
      success: true,
      colorSpace: isCMYK ? "CMYK" : "RGB",
      confidence: isNaN(weightedConfidence) ? 0.5 : weightedConfidence, // 🔧 处理NaN
      details: results,
      summary: `${cmykResults.length}/${
        results.length
      } 个方法检测为CMYK (总权重: CMYK=${cmykWeight.toFixed(
        1
      )}, 总计=${totalWeight.toFixed(1)})`,
    };
  }

  // 🔧 新增：使用 pdfimages 验证（最准确的方法）
  async validateWithPdfImages(pdfPath) {
    const command = `pdfimages -list "${pdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pdfimages验证失败: ${stderr}`));
          return;
        }

        const lines = stdout.split("\n");
        let cmykImages = 0;
        let rgbImages = 0;

        lines.forEach((line) => {
          if (line.includes("cmyk") || line.includes("CMYK")) {
            cmykImages++;
          } else if (
            line.includes("rgb") ||
            line.includes("RGB") ||
            line.includes("gray")
          ) {
            rgbImages++;
          }
        });

        const totalImages = cmykImages + rgbImages;
        const isCMYK = cmykImages > 0 && cmykImages >= rgbImages;

        resolve({
          success: true,
          colorSpace: isCMYK ? "CMYK" : "RGB",
          details: {
            cmykImages,
            rgbImages,
            totalImages,
            rawOutput: stdout,
          },
          method: "pdfimages",
        });
      });
    });
  }

  // 🔧 新增：使用 ImageMagick identify 验证
  async validateWithIdentify(pdfPath) {
    const commands = [
      `identify -verbose "${pdfPath}[0]"`,
      `identify -format "%[colorspace] %[channels]" "${pdfPath}[0]"`,
    ];

    const results = [];

    for (const command of commands) {
      try {
        const result = await new Promise((resolve, reject) => {
          exec(command, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout);
          });
        });
        results.push(result);
      } catch (error) {
        console.warn(`identify子命令失败: ${error.message}`);
      }
    }

    if (results.length === 0) {
      throw new Error("所有identify命令都失败了");
    }

    const combinedOutput = results.join("\n").toLowerCase();
    let colorSpace = "RGB";
    let confidence = 0.5; // 🔧 修复：设置默认值，避免NaN

    const cmykIndicators = [
      "colorspace: cmyk",
      "devicecmyk",
      "channels: 4",
      "cmyk(",
      "type: cmyk",
    ];

    const cmykMatches = cmykIndicators.filter((indicator) =>
      combinedOutput.includes(indicator)
    ).length;

    if (cmykMatches >= 2) {
      colorSpace = "CMYK";
      confidence = Math.min(0.9, 0.6 + cmykMatches * 0.1); // 🔧 确保有效范围
    } else if (cmykMatches >= 1) {
      colorSpace = "CMYK";
      confidence = 0.7;
    }

    return {
      success: true,
      colorSpace,
      confidence, // 🔧 确保返回有效数值
      details: {
        cmykIndicators: cmykMatches,
        totalChecks: cmykIndicators.length,
        rawOutput: results[0]?.substring(0, 500),
      },
      method: "identify-enhanced",
    };
  }

  // 🔧 新增：使用 pdfinfo 验证PDF元数据
  async validateWithPdfInfo(pdfPath) {
    const command = `pdfinfo "${pdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pdfinfo验证失败: ${stderr}`));
          return;
        }

        const output = stdout.toLowerCase();
        let colorSpace = "RGB"; // 默认

        // 检查PDF元数据中的色彩空间信息
        if (
          output.includes("cmyk") ||
          output.includes("devicecmyk") ||
          output.includes("separation")
        ) {
          colorSpace = "CMYK";
        }

        resolve({
          success: true,
          colorSpace,
          details: {
            pdfInfo: stdout,
            hasCMYKIndicators: output.includes("cmyk"),
          },
          method: "pdfinfo",
        });
      });
    });
  }

  // 🔧 增强 exiftool 验证逻辑
  async validateWithExiftool(pdfPath) {
    const command = `exiftool -ColorSpace -Colorants -PrintColorMode -DeviceColorSpace -ICCProfileDescription -ColorComponents "${pdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`exiftool验证失败: ${stderr}`));
          return;
        }

        const output = stdout.toLowerCase();
        let colorSpace = "RGB";
        let confidence = 0.7;

        console.log("🔍 exiftool 原始输出:", stdout); // 🔧 调试输出

        // 🔧 更严格的CMYK检测
        const strongCmykIndicators = [
          "color space                     : cmyk",
          "device color space             : cmyk",
          "icc profile description        : japan color 2001 coated",
          "color components               : 4",
        ];

        const weakCmykIndicators = [
          "colorants                      : cyan",
          "colorants                      : magenta",
          "colorants                      : yellow",
          "colorants                      : black",
          "print color mode               : cmyk",
        ];

        const strongMatches = strongCmykIndicators.filter((indicator) =>
          output.includes(indicator)
        ).length;

        const weakMatches = weakCmykIndicators.filter((indicator) =>
          output.includes(indicator)
        ).length;

        // 🔧 改进判定逻辑
        if (strongMatches >= 1) {
          colorSpace = "CMYK";
          confidence = 0.95;
        } else if (weakMatches >= 3) {
          colorSpace = "CMYK";
          confidence = 0.8;
        } else if (output.includes("cmyk")) {
          colorSpace = "CMYK";
          confidence = 0.6;
        }

        console.log(
          `🔍 exiftool 判定: ${colorSpace} (强指标:${strongMatches}, 弱指标:${weakMatches})`
        );

        resolve({
          success: true,
          colorSpace,
          confidence,
          details: {
            strongMatches,
            weakMatches,
            hasColorSpaceField: output.includes("color space"),
            hasDeviceColorSpace: output.includes("device color space"),
            hasICCProfile: output.includes("icc profile"),
            rawOutput: stdout,
          },
          method: "exiftool",
        });
      });
    });
  }

  // 🔧 添加缺失的 validateWithGhostscript 函数
  async validateWithGhostscript(pdfPath) {
    const command = `gs -q -dNOPAUSE -dBATCH -sDEVICE=inkcov "${pdfPath}" 2>&1`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        const output = (stdout + stderr).toLowerCase();

        // inkcov 设备会显示每页的墨水覆盖率 (C M Y K)
        let colorSpace = "RGB";
        let confidence = 0.6;

        // 检查是否有CMYK墨水覆盖率输出
        const cmykPattern =
          /(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+cmyk/;
        const match = output.match(cmykPattern);

        if (match) {
          colorSpace = "CMYK";
          confidence = 0.8;
        } else if (output.includes("cmyk") || output.includes("devicecmyk")) {
          colorSpace = "CMYK";
          confidence = 0.7;
        }

        resolve({
          success: true,
          colorSpace,
          confidence,
          details: {
            hasInkCoverage: !!match,
            rawOutput: output.substring(0, 300),
          },
          method: "ghostscript",
        });
      });
    });
  }

  // 在colorManager.js中添加真正的像素级验证
  async validateColorSpaceByPixel(pdfPath) {
    const command = `magick "${pdfPath}" -format "%[pixel:p{100,100}]" info:`;

    return new Promise((resolve) => {
      exec(command, (error, stdout) => {
        if (error) {
          resolve({ success: false, error: error.message });
          return;
        }

        const isCMYK = stdout.includes("cmyk(");
        resolve({
          success: true,
          colorSpace: isCMYK ? "CMYK" : "RGB",
          confidence: isCMYK ? 1.0 : 0.5,
          pixelValue: stdout.trim(),
          method: "pixel-analysis",
        });
      });
    });
  }
}

module.exports = ColorManager;
