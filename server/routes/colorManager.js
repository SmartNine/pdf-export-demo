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
  async convertCMYKImageProfessionally(context, originalBuffer) {
    const tools = await this.checkColorTools();

    if (tools.jpgicc) {
      // 方法1: 使用jpgicc（最专业）
      return await this.convertCMYKWithJpgicc(originalBuffer);
    } else if (tools.imagemagick) {
      // 方法2: 使用ImageMagick
      return await this.convertCMYKWithImageMagick(originalBuffer);
    } else {
      // 方法3: Sharp内置转换（基础）
      console.warn("⚠️ 缺少专业CMYK工具，使用基础转换");
      return await context.toColorspace("srgb").toBuffer();
    }
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
    } = options;

    const tools = await this.checkColorTools();
    const profilePath = this.checkICCProfile(iccProfile);

    // 🔧 移植canvas.js的多种转换方法和回退机制
    const conversionMethods = [
      () => this.convertWithJpgicc(inputPdf, outputPdf, profilePath),
      () =>
        this.convertWithImageMagick(inputPdf, outputPdf, profilePath, quality),
      () => this.convertWithGhostscript(inputPdf, outputPdf, quality),
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
  async convertWithImageMagick(inputPdf, outputPdf, iccProfile, quality) {
    const magickInfo = this.availableTools.imagemagick;
    if (!magickInfo.available) {
      throw new Error("ImageMagick不可用");
    }

    // 🔧 改进：更精确的转换参数，保持图像质量
    let command = `${magickInfo.command} -density 300 "${inputPdf}"`; // 🔧 高DPI输入

    // 🔧 关键改进：指定源和目标配置文件
    const srgbProfile = this.checkICCProfile("sRGB");

    if (srgbProfile && iccProfile && fs.existsSync(iccProfile)) {
      // 方法1：双配置文件转换（最精确）
      command += ` -profile "${srgbProfile}" -profile "${iccProfile}"`;
      console.log(`✅ 使用双配置文件转换: sRGB → ${path.basename(iccProfile)}`);
    } else if (iccProfile && fs.existsSync(iccProfile)) {
      // 方法2：只有目标配置文件
      command += ` -colorspace sRGB -profile "${iccProfile}"`;
      console.log(`✅ 使用目标配置文件: ${path.basename(iccProfile)}`);
    } else {
      // 方法3：标准CMYK转换
      command += ` -colorspace cmyk`;
      console.log(`⚠️ 使用标准CMYK转换`);
    }

    // 🔧 改进：保持图像质量的设置
    command += ` -intent Perceptual`; // 感知渲染意图
    command += ` -interpolate catrom`; // 🔧 高质量插值算法
    command += ` -filter Lanczos`; // 🔧 高质量滤镜
    command += ` -unsharp 0.25x0.25+8+0.065`; // 🔧 轻微锐化
    command += ` -quality ${quality}`;
    command += ` -compress jpeg`;
    command += ` -density 300`; // 🔧 输出DPI
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

  // 🔧 改进：Ghostscript回退方案 - 保持高质量图像
  async convertWithGhostscript(inputPdf, outputPdf, quality) {
    // 🔧 改进：使用专业的Ghostscript CMYK转换参数
    const japanProfile = this.checkICCProfile("Japan Color 2001 Coated");
    const srgbProfile = this.checkICCProfile("sRGB");

    let command = `gs -sDEVICE=pdfwrite -dNOPAUSE -dBATCH -dSAFER`;
    command += ` -dCompatibilityLevel=1.4`;
    command += ` -dPDFSETTINGS=/prepress`; // 🔧 改进：使用预印刷设置
    command += ` -dColorConversionStrategy=CMYK`;
    command += ` -dProcessColorModel=/DeviceCMYK`;
    command += ` -dConvertCMYKImagesToRGB=false`;
    command += ` -dConvertImagesToIndexed=false`;

    // 🔧 新增：高质量图像设置
    command += ` -dColorImageResolution=300`;
    command += ` -dGrayImageResolution=300`;
    command += ` -dMonoImageResolution=1200`;
    command += ` -dColorImageDownsampleType=/Bicubic`; // 高质量重采样
    command += ` -dGrayImageDownsampleType=/Bicubic`;
    command += ` -dColorImageFilter=/DCTEncode`; // JPEG压缩
    command += ` -dGrayImageFilter=/DCTEncode`;
    command += ` -dColorImageDict='<< /Quality ${quality} /HSamples [1 1 1 1] /VSamples [1 1 1 1] >>'`;

    // 🔧 关键改进：禁用自动图像缩放
    command += ` -dAutoFilterColorImages=false`;
    command += ` -dAutoFilterGrayImages=false`;
    command += ` -dEncodeColorImages=true`;
    command += ` -dEncodeGrayImages=true`;

    // 🔧 改进：使用ICC配置文件
    if (japanProfile) {
      command += ` -sDefaultCMYKProfile="${japanProfile}"`;
      console.log(
        `✅ Ghostscript使用CMYK配置文件: ${path.basename(japanProfile)}`
      );
    }

    if (srgbProfile) {
      command += ` -sDefaultRGBProfile="${srgbProfile}"`;
      console.log(
        `✅ Ghostscript使用RGB配置文件: ${path.basename(srgbProfile)}`
      );
    }

    // 🔧 改进：渲染意图和矢量保持
    command += ` -dRenderIntent=1`; // 1 = Perceptual
    command += ` -dPreserveEPSInfo=false`;
    command += ` -dPreserveOPIComments=false`;
    command += ` -dOptimize=true`;
    command += ` -sOutputFile="${outputPdf}" "${inputPdf}"`;

    console.log(`📝 高质量Ghostscript命令: ${command}`);

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Ghostscript转换失败: ${stderr}`));
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: !!japanProfile,
            method: "Ghostscript High-Quality",
          });
        }
      });
    });
  }

  // 🔧 新增：色彩验证工具
  async validateColorSpace(pdfPath) {
    const command = `pdfimages -list "${pdfPath}"`;

    return new Promise((resolve) => {
      exec(command, (error, stdout) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          const hasCMYK = stdout.includes("cmyk") || stdout.includes("CMYK");
          resolve({
            success: true,
            colorSpace: hasCMYK ? "CMYK" : "RGB",
            details: stdout,
          });
        }
      });
    });
  }
}

module.exports = ColorManager;
